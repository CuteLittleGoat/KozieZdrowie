# KozieZdrowie

Statyczna aplikacja GitHub Pages do prezentowania pomiarów ciśnienia krwi i tętna oraz przygotowywania jasnego raportu do zapisania jako PDF.

## Dodawanie danych

1. Wgraj dowolną liczbę plików `.csv` do folderu `Dane/`.
2. Nazwy plików mogą być dowolne.
3. Zatwierdź zmiany na gałęzi `main`.
4. GitHub Actions automatycznie scali dane i wdroży nową wersję strony.

Oczekiwane kolumny:

- `Data`
- `Godzina`
- `Skurczowe (mmHg)`
- `Rozkurczowe (mmHg)`
- `Tętno (uderzenia na minutę)`

Parser obsługuje typowe kodowania polskich plików CSV oraz separatory: średnik, przecinek i tabulator.

## Zasady przetwarzania

- identyczna data, godzina i wartości są traktowane jako duplikat;
- identyczna data i godzina, ale różne wartości, tworzą wpis `Niekompletne dane` wyłączony z wykresów i średnich;
- wpis bez ciśnienia skurczowego lub rozkurczowego jest pomijany;
- rano oznacza `00:00–11:59`, a wieczorem `12:00–23:59`;
- pomiary z jednej pory dnia są prezentowane jako jeden uśredniony punkt;
- odstęp większy niż 10 minut rozpoczyna kolejną serię, co jest pokazywane w szczegółach punktu;
- brak porannego lub wieczornego pomiaru pozostawia przerwę na wykresie.

## PDF

Przycisk **Generuj PDF** przygotowuje jasny, wielostronicowy raport obejmujący cały okres danych. Następnie otwiera okno drukowania przeglądarki, w którym należy wybrać opcję zapisu jako PDF. Raport zawiera podsumowanie, miesięczne wykresy i kompletną tabelę pomiarów po deduplikacji.

## GitHub Pages

W ustawieniach repozytorium wybierz:

`Settings → Pages → Build and deployment → Source: GitHub Actions`

Workflow znajduje się w `.github/workflows/pages.yml`.

> **Prywatność:** repozytorium i GitHub Pages są publiczne. Pliki CSV zawierające dane zdrowotne nie powinny zawierać imienia, nazwiska, adresu ani innych danych pozwalających zidentyfikować osobę.
