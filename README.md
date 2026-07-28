# toys_for_Janek

Lista prezentowa (wishlist) dla Janka: wtyczka do Chrome do dodawania zabawek podczas przeglądania sklepów + strona (GitHub Pages) z widokiem gościa (kto co jeszcze może kupić) i panelem administratora. Backend: Firebase (Firestore + Authentication, plan darmowy).

- `extension/` — wtyczka Chrome (Manifest V3), do użytku na komputerze.
- `docs/` — strona statyczna (GitHub Pages): `index.html` (widok gościa), `admin.html` (panel administratora), `bookmarklet.html` (odpowiednik wtyczki na telefon).
- `firestore.rules` — reguły bezpieczeństwa Firestore.
- `scripts/set-admin-claim.js` — jednorazowy skrypt nadający uprawnienia administratora.

Pełna instrukcja konfiguracji krok po kroku: **[SETUP.md](SETUP.md)**.

Oryginalne wymagania: [wymagania.txt](wymagania.txt).