"use strict";

const state = { data: null, range: "30" };
const COLORS = { systolic: "#5a9cf0", diastolic: "#eb625d", pulse: "#95c95a" };
const SERIES = [
  { key: "systolic", short: "S", label: "Skurczowe (mmHg)", legend: "Skurczowe [mmHg]", color: COLORS.systolic },
  { key: "diastolic", short: "R", label: "Rozkurczowe (mmHg)", legend: "Rozkurczowe [mmHg]", color: COLORS.diastolic },
  { key: "pulse", short: "T", label: "Tętno (uderzenia/min)", legend: "Tętno [ud./min]", color: COLORS.pulse },
];
const PRINT_CHART_DAYS_PER_PAGE = 12;
const PRINT_TABLE_ROWS_PER_PAGE = 22;

const $ = (selector) => document.querySelector(selector);
const formatNumber = (value) => value == null ? "—" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value);
const formatDate = (value) => value ? new Intl.DateTimeFormat("pl-PL").format(new Date(`${value}T12:00:00`)) : "—";
const formatPeriod = (value) => value === "rano" ? "Rano" : value === "wieczorem" ? "Wieczór" : value;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function rangeBounds() {
  const slots = state.data?.slots || [];
  if (!slots.length) return { from: null, to: null };
  const to = slots[slots.length - 1].date;
  if (state.range === "all") return { from: slots[0].date, to };
  const fromDate = new Date(`${to}T12:00:00`);
  fromDate.setDate(fromDate.getDate() - Number(state.range) + 1);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

function filteredSlots() {
  const { from, to } = rangeBounds();
  return (state.data?.slots || []).filter(slot => (!from || slot.date >= from) && (!to || slot.date <= to));
}

function filteredMeasurements() {
  const { from, to } = rangeBounds();
  return (state.data?.measurements || []).filter(item => (!from || item.date >= from) && (!to || item.date <= to));
}

function renderSummary(slots) {
  const populated = slots.filter(slot => slot.hasData);
  $("#date-range").textContent = slots.length
    ? `${formatDate(slots[0].date)} – ${formatDate(slots[slots.length - 1].date)}`
    : "—";
  $("#measurement-count").textContent = `${populated.length} ${populated.length === 1 ? "punkt" : "punktów"} rano/wieczorem`;
}

function pressureFlag(item) {
  if (item.status === "conflict" || item.systolic == null || item.diastolic == null) {
    return { label: "NIEKOMPLETNE DANE", className: "flag-incomplete" };
  }

  const systolic = Number(item.systolic);
  const diastolic = Number(item.diastolic);

  if (systolic >= 180 || diastolic >= 120) {
    return { label: "BARDZO WYSOKIE", className: "flag-critical" };
  }
  if (systolic >= 150 || diastolic >= 95) {
    return { label: "WYSOKIE", className: "flag-high" };
  }
  if (systolic >= 135 || diastolic >= 85) {
    return { label: "PODWYŻSZONE", className: "flag-elevated" };
  }
  if (systolic < 90 || diastolic < 60) {
    return { label: "NISKIE", className: "flag-low" };
  }
  return { label: "BRAK", className: "flag-none" };
}

function pulseFlag(item) {
  if (item.status === "conflict") {
    return { label: "NIEKOMPLETNE DANE", className: "flag-incomplete" };
  }
  if (item.pulse == null) {
    return { label: "BRAK DANYCH", className: "flag-incomplete" };
  }

  const pulse = Number(item.pulse);
  if (pulse < 40 || pulse > 120) {
    return { label: "MOCNE OSTRZEŻENIE", className: "flag-strong-warning" };
  }
  if (pulse < 60 || pulse > 100) {
    return { label: "WYMAGA UWAGI", className: "flag-attention" };
  }
  return { label: "BRAK", className: "flag-none" };
}

function flagBadge(flag) {
  return `<span class="flag-badge ${flag.className}">${escapeHtml(flag.label)}</span>`;
}

function chartValues(slots) {
  return SERIES.flatMap(series => slots.map(slot => slot[series.key])).filter(value => value != null).map(Number);
}

function groupSlotsByDate(slots) {
  return slots.reduce((groups, slot) => {
    let group = groups[groups.length - 1];
    if (!group || group.date !== slot.date) {
      group = { date: slot.date, slots: [] };
      groups.push(group);
    }
    group.slots.push(slot);
    return groups;
  }, []);
}

function makeChartSvg(slots, options = {}) {
  const light = Boolean(options.light);
  const print = Boolean(options.print);
  const dayGroups = groupSlotsByDate(slots);
  const preferredDayWidth = print ? 84 : 150;
  const width = options.width || Math.max(print ? 1080 : 760, dayGroups.length * preferredDayWidth + 100);
  const height = options.height || (print ? 610 : 530);
  const margin = { top: 58, right: 24, bottom: print ? 150 : 150, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const plotBottom = margin.top + plotHeight;
  const dayWidth = dayGroups.length ? plotWidth / dayGroups.length : plotWidth;
  const values = chartValues(slots);
  let min = values.length ? Math.floor((Math.min(...values) - 10) / 10) * 10 : 40;
  let max = values.length ? Math.ceil((Math.max(...values) + 10) / 10) * 10 : 160;
  if (max - min < 60) { min -= 10; max += 10; }
  min = Math.max(0, min);

  const slotCoordinates = new Map();
  dayGroups.forEach((group, dayIndex) => {
    group.slots.forEach((slot, slotIndex) => {
      const relativePosition = (slotIndex + 1) / (group.slots.length + 1);
      slotCoordinates.set(slot.id, margin.left + dayIndex * dayWidth + relativePosition * dayWidth);
    });
  });

  const x = index => slotCoordinates.get(slots[index].id);
  const y = value => margin.top + (max - Number(value)) * plotHeight / (max - min);
  const bg = light ? "#ffffff" : "#0e151f";
  const text = light ? "#333333" : "#aebaca";
  const strongText = light ? "#171717" : "#eef4fb";
  const mutedText = light ? "#666666" : "#8998aa";
  const grid = light ? "#d7d7d7" : "#2a3748";
  const axis = light ? "#777777" : "#607086";
  const dayBand = light ? "#f5f7f9" : "#111b27";
  const separator = light ? "#c9cdd2" : "#344357";
  const fontSize = print ? 8 : 10;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title">`,
    `<title id="chart-title">Wykres ciśnienia skurczowego, rozkurczowego i tętna z wartościami dla pomiarów porannych i wieczornych</title>`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
  ];

  dayGroups.forEach((group, dayIndex) => {
    const startX = margin.left + dayIndex * dayWidth;
    if (dayIndex % 2 === 1) {
      parts.push(`<rect x="${startX.toFixed(2)}" y="${margin.top}" width="${dayWidth.toFixed(2)}" height="${(height - margin.top - 18).toFixed(2)}" fill="${dayBand}"/>`);
    }
    if (dayIndex > 0) {
      parts.push(`<line x1="${startX.toFixed(2)}" y1="${margin.top}" x2="${startX.toFixed(2)}" y2="${height - 18}" stroke="${separator}" stroke-width="1"/>`);
    }
  });

  for (let i = 0; i <= 6; i++) {
    const value = min + (max - min) * i / 6;
    const yy = y(value);
    parts.push(`<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" stroke="${grid}" stroke-width="1"/>`);
    parts.push(`<text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" fill="${text}" font-size="11">${Math.round(value)}</text>`);
  }
  parts.push(`<line x1="${margin.left}" y1="${plotBottom}" x2="${width - margin.right}" y2="${plotBottom}" stroke="${axis}"/>`);

  dayGroups.forEach((group, dayIndex) => {
    const centerX = margin.left + dayIndex * dayWidth + dayWidth / 2;
    parts.push(`<text x="${centerX.toFixed(2)}" y="${plotBottom + 22}" text-anchor="middle" fill="${strongText}" font-size="${print ? 8.5 : 10.5}" font-weight="700">${escapeHtml(formatDate(group.date))}</text>`);

    group.slots.forEach(slot => {
      const slotX = slotCoordinates.get(slot.id);
      parts.push(`<line x1="${slotX.toFixed(2)}" y1="${plotBottom}" x2="${slotX.toFixed(2)}" y2="${plotBottom + 5}" stroke="${axis}"/>`);
      parts.push(`<text x="${slotX.toFixed(2)}" y="${plotBottom + 41}" text-anchor="middle" fill="${mutedText}" font-size="${print ? 7.5 : 9}" font-weight="700">${escapeHtml(formatPeriod(slot.period))}</text>`);

      SERIES.forEach((series, rowIndex) => {
        const rowY = plotBottom + 62 + rowIndex * (print ? 16 : 18);
        parts.push(`<text x="${(slotX - 2).toFixed(2)}" y="${rowY}" text-anchor="end" fill="${series.color}" font-size="${fontSize}" font-weight="800">${series.short}:</text>`);
        parts.push(`<text x="${(slotX + 2).toFixed(2)}" y="${rowY}" text-anchor="start" fill="${strongText}" font-size="${fontSize}">${escapeHtml(formatNumber(slot[series.key]))}</text>`);
      });
    });
  });

  SERIES.forEach(series => {
    let path = "";
    slots.forEach((slot, index) => {
      const value = slot[series.key];
      if (value == null) return;
      const previousExists = index > 0 && slots[index - 1][series.key] != null;
      path += `${previousExists ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)} `;
    });
    parts.push(`<path d="${path}" fill="none" stroke="${series.color}" stroke-width="${print ? 2.3 : 3}" stroke-linejoin="round" stroke-linecap="round"/>`);
    slots.forEach((slot, index) => {
      const value = slot[series.key];
      if (value == null) return;
      const details = `${formatDate(slot.date)} — ${formatPeriod(slot.period)}\n${series.label}: ${formatNumber(value)}\nPomiary źródłowe: ${slot.measurementCount}\nSerie: ${slot.seriesCount}${slot.conflictCount ? `\nKonflikty pominięte: ${slot.conflictCount}` : ""}`;
      parts.push(`<circle cx="${x(index)}" cy="${y(value)}" r="${print ? 2.4 : 4}" fill="${series.color}" stroke="${bg}" stroke-width="1.5"><title>${escapeHtml(details)}</title></circle>`);
    });
  });

  SERIES.forEach((series, index) => {
    const legendX = margin.left + (index + 0.5) * plotWidth / SERIES.length;
    parts.push(`<line x1="${legendX - (print ? 70 : 84)}" y1="25" x2="${legendX - (print ? 48 : 58)}" y2="25" stroke="${series.color}" stroke-width="3"/>`);
    parts.push(`<text x="${legendX - (print ? 42 : 51)}" y="29" fill="${text}" font-size="${print ? 9 : 11}"><tspan fill="${series.color}" font-weight="800">${series.short}</tspan><tspan> — ${escapeHtml(series.legend)}</tspan></text>`);
  });

  parts.push("</svg>");
  return parts.join("");
}

function renderChart(slots) {
  const chart = $("#chart");
  if (!slots.length || !slots.some(slot => slot.hasData)) {
    chart.innerHTML = '<div class="empty">Brak prawidłowych pomiarów w wybranym zakresie.</div>';
    return;
  }
  chart.innerHTML = makeChartSvg(slots);
  requestAnimationFrame(() => { $("#chart-scroll").scrollLeft = $("#chart-scroll").scrollWidth; });
}

function renderTable(measurements) {
  const body = $("#measurements-body");
  if (!measurements.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">Brak pomiarów w wybranym zakresie.</td></tr>';
    return;
  }

  body.innerHTML = [...measurements].reverse().map(item => {
    const pressure = pressureFlag(item);
    const pulse = pulseFlag(item);
    return `<tr>
      <td>${formatDate(item.date)}</td><td>${escapeHtml(item.period)}</td><td>${escapeHtml(item.time)}</td>
      <td>${formatNumber(item.systolic)}</td><td>${formatNumber(item.diastolic)}</td><td>${formatNumber(item.pulse)}</td>
      <td>${flagBadge(pressure)}</td><td>${flagBadge(pulse)}</td>
    </tr>`;
  }).join("");
}

function renderAudit() {
  const audit = state.data.audit;
  const errors = audit.fileErrors?.length ? `<p class="status-danger">Błędy plików:</p><ul class="audit-list">${audit.fileErrors.map(error => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : "";
  $("#audit").innerHTML = `
    <p>Pliki CSV: <strong>${audit.csvFileCount}</strong><br>
    Wczytane wiersze przed deduplikacją: <strong>${audit.parsedRowsBeforeDeduplication}</strong><br>
    Usunięte duplikaty: <strong>${audit.duplicatesRemoved}</strong><br>
    Konflikty daty i godziny: <strong>${audit.conflictTimestamps}</strong><br>
    Pominięte wpisy bez ciśnienia: <strong>${audit.missingPressureRows}</strong><br>
    Pominięte wpisy z nieprawidłową datą lub godziną: <strong>${audit.invalidRows}</strong></p>${errors}`;
}

function render() {
  const slots = filteredSlots();
  renderSummary(slots);
  renderChart(slots);
  renderTable(filteredMeasurements());
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function chunkSlotsByDay(slots, daysPerChunk) {
  return chunkArray(groupSlotsByDate(slots), daysPerChunk).map(days => days.flatMap(day => day.slots));
}

function printRow(item) {
  const pressure = pressureFlag(item);
  const pulse = pulseFlag(item);
  const conflictClass = item.status === "conflict" ? "print-conflict" : "";
  return `<tr class="${conflictClass}">
    <td>${formatDate(item.date)}</td><td>${escapeHtml(item.period)}</td><td>${escapeHtml(item.time)}</td>
    <td>${formatNumber(item.systolic)}</td><td>${formatNumber(item.diastolic)}</td><td>${formatNumber(item.pulse)}</td>
    <td>${pressure.className === "flag-none" ? "" : flagBadge(pressure)}</td><td>${pulse.className === "flag-none" ? "" : flagBadge(pulse)}</td>
  </tr>`;
}

function printPageHeader(segment, title, part, total, fromDate, toDate) {
  return `<header class="print-page-header">
    <div>
      <p class="print-segment">${escapeHtml(segment)}</p>
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="print-page-meta">
      <strong>Część ${part} z ${total}</strong>
      <span>${formatDate(fromDate)} – ${formatDate(toDate)}</span>
    </div>
  </header>`;
}

function preparePrintReport() {
  const data = state.data;
  const chartChunks = chunkSlotsByDay(data.slots || [], PRINT_CHART_DAYS_PER_PAGE);
  const sortedMeasurements = [...(data.measurements || [])].sort((a, b) => a.datetime.localeCompare(b.datetime));
  const tableChunks = chunkArray(sortedMeasurements, PRINT_TABLE_ROWS_PER_PAGE);

  const chartPages = (chartChunks.length ? chartChunks : [[]]).map((slots, index, all) => {
    const fromDate = slots[0]?.date || data.summary.oldestDate;
    const toDate = slots[slots.length - 1]?.date || data.summary.newestDate;
    const chart = slots.length
      ? makeChartSvg(slots, { light: true, print: true, width: 1120, height: 610 })
      : '<p class="print-empty">Brak danych do przedstawienia na wykresie.</p>';
    return `<section class="print-page print-chart-page">
      ${printPageHeader("Segment 1 — Wykres", "Pomiary ciśnienia i tętna", index + 1, all.length, fromDate, toDate)}
      <div class="print-chart-frame">${chart}</div>
    </section>`;
  }).join("");

  const tablePages = (tableChunks.length ? tableChunks : [[]]).map((measurements, index, all) => {
    const fromDate = measurements[0]?.date || data.summary.oldestDate;
    const toDate = measurements[measurements.length - 1]?.date || data.summary.newestDate;
    const rows = measurements.length
      ? measurements.map(printRow).join("")
      : '<tr><td colspan="8" class="print-empty">Brak pomiarów do przedstawienia.</td></tr>';
    return `<section class="print-page print-table-page">
      ${printPageHeader("Segment 2 — Tabela", "Lista pomiarów", index + 1, all.length, fromDate, toDate)}
      <table class="print-table">
        <thead><tr><th>Data</th><th>Pora</th><th>Godzina</th><th>Skurczowe</th><th>Rozkurczowe</th><th>Tętno</th><th>Flaga ciśnienia</th><th>Flaga tętna</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }).join("");

  $("#print-report").innerHTML = chartPages + tablePages;
}

async function loadData() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    const audit = state.data.audit;
    $("#status").textContent = `Dane zbudowane: ${new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.data.generatedAt))}. Wczytano ${audit.csvFileCount} plików CSV.`;
    $("#range-select").disabled = false;
    $("#print-button").disabled = false;
    renderAudit();
    render();
  } catch (error) {
    $("#status").classList.add("error");
    $("#status").textContent = `Nie udało się wczytać danych: ${error.message}`;
  }
}

$("#range-select").addEventListener("change", event => { state.range = event.target.value; render(); });
$("#print-button").addEventListener("click", () => {
  preparePrintReport();
  $("#print-report").setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
});
window.addEventListener("afterprint", () => $("#print-report").setAttribute("aria-hidden", "true"));
loadData();