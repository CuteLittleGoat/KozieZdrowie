#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import shutil
import statistics
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "Dane"
DIST = ROOT / "dist"
SERIES_MINUTES = 10

ALIASES = {
    "date": ("data", "date"),
    "time": ("godzina", "czas", "time"),
    "sys": ("skurczowe (mmhg)", "skurczowe", "cisnienie skurczowe (mmhg)"),
    "dia": ("rozkurczowe (mmhg)", "rozkurczowe", "cisnienie rozkurczowe (mmhg)"),
    "pulse": ("tetno (uderzenia na minute)", "tetno", "puls", "pulse"),
}


def norm(value):
    text = " ".join(str(value or "").replace("\ufeff", "").strip().lower().split())
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


def decode(raw):
    for encoding in ("utf-8-sig", "utf-8", "cp1250", "iso-8859-2", "latin-1"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", errors="replace"), "utf-8-replace"


def number(value):
    text = str(value or "").strip().replace(" ", "").replace("\u00a0", "").replace(",", ".")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def nice(value):
    if value is None:
        return None
    value = round(float(value), 1)
    return int(value) if value.is_integer() else value


def parse_date(value):
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def parse_time(value):
    text = str(value or "").strip()
    for fmt in ("%H:%M", "%H:%M:%S", "%H.%M", "%H.%M.%S"):
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            pass
    return None


def columns(fieldnames):
    source = {norm(name): name for name in fieldnames or [] if name}
    found = {}
    for key, aliases in ALIASES.items():
        for alias in aliases:
            if alias in source:
                found[key] = source[alias]
                break
    return found


def read_rows():
    rows, files, errors = [], [], []
    missing_pressure = invalid = 0
    paths = sorted(DATA.rglob("*.csv")) if DATA.exists() else []
    for path in paths:
        rel = path.relative_to(ROOT).as_posix()
        try:
            text, encoding = decode(path.read_bytes())
            sample = text[:8192]
            try:
                delimiter = csv.Sniffer().sniff(sample, delimiters=";,\t,").delimiter
            except csv.Error:
                delimiter = max((";", ",", "\t"), key=sample.count)
            reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
            cols = columns(reader.fieldnames)
            if not {"date", "time", "sys", "dia"}.issubset(cols):
                raise ValueError("brak wymaganych kolumn")
            accepted = skipped = 0
            for row_no, row in enumerate(reader, 2):
                day = parse_date(row.get(cols["date"]))
                clock = parse_time(row.get(cols["time"]))
                sys_value = number(row.get(cols["sys"]))
                dia_value = number(row.get(cols["dia"]))
                pulse = number(row.get(cols["pulse"])) if "pulse" in cols else None
                if sys_value is None or dia_value is None:
                    missing_pressure += 1
                    skipped += 1
                    continue
                if day is None or clock is None:
                    invalid += 1
                    skipped += 1
                    continue
                rows.append({
                    "dt": datetime.combine(day, clock), "sys": sys_value, "dia": dia_value,
                    "pulse": pulse, "file": rel, "row": row_no,
                })
                accepted += 1
            files.append({"name": rel, "encoding": encoding, "delimiter": "TAB" if delimiter == "\t" else delimiter,
                          "acceptedRows": accepted, "skippedRows": skipped})
        except Exception as exc:
            errors.append(f"{rel}: {exc}")
    return rows, {"csvFileCount": len(paths), "files": files, "fileErrors": errors,
                  "missingPressureRows": missing_pressure, "invalidRows": invalid}


def period(dt):
    return "rano" if dt.hour < 12 else "wieczorem"


def deduplicate(rows):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["dt"]].append(row)
    output, duplicates, conflicts = [], 0, 0
    for dt in sorted(grouped):
        group = grouped[dt]
        variants = defaultdict(list)
        for row in group:
            variants[(row["sys"], row["dia"], row["pulse"])].append(row)
        pressures = {(v[0], v[1]) for v in variants}
        pulses = {v[2] for v in variants if v[2] is not None}
        common = {
            "id": dt.isoformat(), "datetime": dt.isoformat(), "date": dt.date().isoformat(),
            "time": dt.strftime("%H:%M:%S").rstrip("0").rstrip(":"), "period": period(dt),
            "sources": [{"file": r["file"], "row": r["row"]} for r in group],
        }
        if len(variants) == 1 or (len(pressures) == 1 and len(pulses) <= 1):
            chosen = max(group, key=lambda r: r["pulse"] is not None)
            duplicates += max(0, len(group) - 1)
            output.append({**common, "status": "valid", "systolic": nice(chosen["sys"]),
                           "diastolic": nice(chosen["dia"]), "pulse": nice(next(iter(pulses)) if pulses else None),
                           "duplicateCount": max(0, len(group) - 1)})
        else:
            conflicts += 1
            duplicates += sum(max(0, len(items) - 1) for items in variants.values())
            details = []
            for variant, items in variants.items():
                details.append({"systolic": nice(variant[0]), "diastolic": nice(variant[1]),
                                "pulse": nice(variant[2]),
                                "sources": [{"file": r["file"], "row": r["row"]} for r in items]})
            output.append({**common, "status": "conflict", "systolic": None, "diastolic": None,
                           "pulse": None, "duplicateCount": max(0, len(group) - len(variants)),
                           "variants": details})
    return output, {"duplicatesRemoved": duplicates, "conflictTimestamps": conflicts}


def average(items, key):
    values = [float(item[key]) for item in items if item[key] is not None]
    return nice(statistics.fmean(values)) if values else None


def series_count(items):
    if not items:
        return 0
    count, previous = 1, datetime.fromisoformat(items[0]["datetime"])
    for item in items[1:]:
        current = datetime.fromisoformat(item["datetime"])
        if current - previous > timedelta(minutes=SERIES_MINUTES):
            count += 1
        previous = current
    return count


def build_slots(measurements):
    if not measurements:
        return []
    valid, conflict = defaultdict(list), defaultdict(list)
    for item in measurements:
        target = valid if item["status"] == "valid" else conflict
        target[(item["date"], item["period"])].append(item)
    first = min(date.fromisoformat(item["date"]) for item in measurements)
    last = max(date.fromisoformat(item["date"]) for item in measurements)
    result, current = [], first
    while current <= last:
        day = current.isoformat()
        for label in ("rano", "wieczorem"):
            items = sorted(valid[(day, label)], key=lambda x: x["datetime"])
            result.append({"id": f"{day}-{label}", "date": day, "period": label,
                           "label": f"{day} ({label})", "systolic": average(items, "systolic"),
                           "diastolic": average(items, "diastolic"), "pulse": average(items, "pulse"),
                           "measurementCount": len(items), "seriesCount": series_count(items),
                           "conflictCount": len(conflict[(day, label)]), "times": [x["time"] for x in items],
                           "hasData": bool(items)})
        current += timedelta(days=1)
    return result


def stats(slots, key):
    values = [float(slot[key]) for slot in slots if slot["hasData"] and slot[key] is not None]
    if not values:
        return {"average": None, "minimum": None, "maximum": None}
    return {"average": nice(statistics.fmean(values)), "minimum": nice(min(values)), "maximum": nice(max(values))}


def main():
    rows, audit = read_rows()
    measurements, dedupe = deduplicate(rows)
    slots = build_slots(measurements)
    populated = [slot for slot in slots if slot["hasData"]]
    audit.update(dedupe)
    audit.update({"parsedRowsBeforeDeduplication": len(rows), "measurementsAfterDeduplication": len(measurements),
                  "seriesGapMinutes": SERIES_MINUTES})
    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"), "schemaVersion": 1,
        "rules": {"morning": "00:00–11:59", "evening": "12:00–23:59", "seriesGapMinutes": SERIES_MINUTES},
        "summary": {"oldestDate": slots[0]["date"] if slots else None,
                    "newestDate": slots[-1]["date"] if slots else None,
                    "validMeasurementCount": sum(x["status"] == "valid" for x in measurements),
                    "groupedSlotCount": len(populated), "emptySlotCount": len(slots) - len(populated),
                    "conflictCount": sum(x["status"] == "conflict" for x in measurements),
                    "systolic": stats(slots, "systolic"), "diastolic": stats(slots, "diastolic"),
                    "pulse": stats(slots, "pulse")},
        "audit": audit, "slots": slots, "measurements": measurements,
    }
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for name in ("index.html", "styles.css", "app.js"):
        shutil.copy2(ROOT / name, DIST / name)
    (DIST / "data.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    print(f"CSV: {audit['csvFileCount']}; pomiary: {payload['summary']['validMeasurementCount']}; duplikaty: {audit['duplicatesRemoved']}; konflikty: {payload['summary']['conflictCount']}")


if __name__ == "__main__":
    main()
