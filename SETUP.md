# Konfiguracja — Lista zabawek dla Janka

Ten projekt składa się z trzech części:
- `extension/` — wtyczka do Chrome (Manifest V3), do wskazywania zabawek podczas przeglądania sklepów.
- `docs/` — statyczna strona (hostowana za darmo na GitHub Pages) z widokiem gościa i panelem administratora.
- Wspólny backend: **Firebase** (plan darmowy Spark — tylko Firestore + Authentication, bez Cloud Functions/Blaze).

Poniżej pełna konfiguracja od zera. Zajmie ok. 20–30 minut, raz.

## 1. Utwórz projekt Firebase

1. Wejdź na https://console.firebase.google.com i kliknij "Dodaj projekt".
2. Nadaj nazwę (np. `toys-for-janek`), wyłącz Google Analytics (niepotrzebny).
3. Po utworzeniu projektu zanotuj **Project ID** (widoczny w ustawieniach projektu, ikona ⚙️ → "Ustawienia projektu").

## 2. Włącz logowanie (Authentication)

1. W menu po lewej: **Build → Authentication → Get started**.
2. Zakładka "Sign-in method" → włącz dostawcę **Email/Password**.
3. Tamże włącz też dostawcę **Anonymous** (potrzebny do widoku gościa).

## 3. Utwórz bazę Firestore

1. **Build → Firestore Database → Create database**.
2. Wybierz tryb **produkcyjny** (production mode) i dowolny region (najbliższy Polsce, np. `eur3`).
3. Po utworzeniu przejdź do zakładki **Rules** i wklej całą zawartość pliku [`firestore.rules`](firestore.rules) z tego repozytorium, zastępując domyślną treść. Kliknij **Publish**.

   (Alternatywnie, jeśli wolisz linię poleceń: zainstaluj `npm install -g firebase-tools`, `firebase login`, `firebase init firestore` w tym katalogu, wskaż istniejący plik `firestore.rules`, potem `firebase deploy --only firestore:rules`.)

## 4. Utwórz konto administratora

1. **Authentication → Users → Add user**.
2. Podaj e-mail (np. Twój) i hasło — to będzie login do panelu administratora (`admin.html`) i do wtyczki.

## 5. Nadaj kontu uprawnienia administratora (custom claim)

Firestore musi wiedzieć, że to konto jest administratorem — robi to jednorazowy skrypt lokalny (nie wgrywany nigdzie).

1. **Project settings → Service accounts → Generate new private key** — pobierze się plik JSON. **Zapisz go poza repozytorium** (albo w repo, ale upewnij się że nazwa zaczyna się od `service-account`, bo `.gitignore` już to blokuje przed przypadkowym commitem).
2. W terminalu:
   ```
   cd scripts
   npm install
   node set-admin-claim.js /pełna/ścieżka/do/service-account.json twoj-email@przyklad.pl
   ```
3. Skrypt wypisze potwierdzenie. Usuń/schowaj plik JSON po użyciu — nie jest już potrzebny na co dzień.

## 6. Klucze API (Google Cloud Console)

Klucz Web API Firebase nie jest tajny (bezpieczeństwo zapewniają reguły Firestore, nie ukrycie klucza), ale warto dodatkowo ograniczyć go po "referrer", żeby nie dało się go łatwo użyć skądinąd:

1. Wejdź na https://console.cloud.google.com/apis/credentials (upewnij się, że wybrany jest ten sam projekt).
2. Znajdziesz tam domyślny klucz Firebase (Browser key). Kliknij go, skopiuj wartość — to Twój `apiKey`.
3. Zalecane: sklonuj go na dwa osobne klucze:
   - jeden z ograniczeniem HTTP referrer do adresu Twojej strony GitHub Pages (np. `https://twoj-login.github.io/*`) — użyj w `docs/config.js`.
   - drugi z ograniczeniem do `chrome-extension://ID_TWOJEJ_WTYCZKI/*` (ID zobaczysz w kroku 8, po wczytaniu wtyczki) — użyj w `extension/config.js`.
   Jeśli to zbyt dużo na raz, możesz na start użyć tego samego klucza w obu miejscach i ograniczyć je później.

## 7. Uzupełnij pliki konfiguracyjne

Uzupełnij **oba** pliki (Project ID i apiKey znajdziesz w Project settings → General, apiKey też widoczny tam pod "Web API Key"):

- `extension/config.js` → `apiKey`, `projectId`.
- `docs/config.js` → `apiKey`, `projectId`.

Hasła dla gości NIE ma w żadnym pliku — ustawisz je w panelu admina w kroku 10, żeby nigdy nie trafiło do repozytorium.

## 8. Wczytaj wtyczkę w Chrome

1. Otwórz `chrome://extensions`.
2. Włącz "Tryb dewelopera" (Developer mode) w prawym górnym rogu.
3. "Załaduj rozpakowane" (Load unpacked) → wskaż folder `extension/` z tego repozytorium.
4. Przypnij wtyczkę do paska narzędzi (ikonka puzzli → pinezka obok "Toys for Janek").
5. Zanotuj **ID wtyczki** wyświetlone na karcie — przyda się do ograniczenia klucza API (krok 6).

To rozwiązanie jest do użytku prywatnego/rodzinnego — nie ma potrzeby publikować wtyczki w Chrome Web Store.

## 9. Włącz GitHub Pages

1. W ustawieniach repozytorium na GitHubie: **Settings → Pages**.
2. Source: "Deploy from a branch", branch: `main`, folder: `/docs`.
3. Po chwili strona będzie dostępna pod adresem w stylu `https://twoj-login.github.io/toys_for_Janek/`.

## 10. Ustal hasło rodzinne dla widoku gościa

To zabezpieczenie jest **kosmetyczne** (odstrasza przypadkowych odwiedzających i wyszukiwarki, nie jest kryptograficznym zabezpieczeniem — strona jest statyczna, więc prawdziwej ochrony odczytu nie da się tu zrobić bez płatnego planu Firebase), ale w pełni wystarcza do tego celu. Hash hasła jest trzymany w Firestore (`appConfig/guestGate`), nie w repozytorium — dzięki temu możesz je też zmienić w każdej chwili bez commitowania kodu.

1. Wejdź na `admin.html`, zaloguj się kontem administratora.
2. Kliknij **⚙️ Ustawienia**, wpisz wybrane hasło rodzinne (np. `mikolaj2026`), kliknij **Zapisz hasło**.
3. Wejdź na `index.html` i sprawdź, że to hasło działa.

## Szybka weryfikacja końcowa

- W wtyczce: zaloguj się, wejdź na stronę jakiejś zabawki w sklepie, kliknij "Zeskanuj tę stronę", popraw dane, zapisz — sprawdź, że pojawia się w Firestore (konsola Firebase → Firestore Database → kolekcja `toys`).
- Na `index.html`: podaj hasło rodzinne, sprawdź że zabawka jest widoczna, kliknij "Kupię to!", podaj imię — zabawka powinna zniknąć z listy.
- Na `admin.html`: zaloguj się, sprawdź że widać WSZYSTKIE zabawki (też zarezerwowane), przetestuj edycję, usuwanie, cofanie rezerwacji i zmianę hasła gościa.

## Znane, świadomie zaakceptowane ograniczenia

- Hasło rodzinne na stronie gościa to bariera kosmetyczna — technicznie zaawansowany gość mógłby je pominąć, wywołując bezpośrednio API Firebase (hash w Firestore jest publicznie odczytywalny, tak jak wcześniej był w kodzie). Prawdziwe zabezpieczenie (App Check / Cloud Functions) wymagałoby płatnego planu Firebase, co było świadomie wykluczone.
- Nie ma limitu częstotliwości rezerwacji (rate limiting) — przy małym gronie rodzinnym to akceptowalne ryzyko.
- Nazwa/cena/zdjęcie wykrywane przez wtyczkę to zgadywanie na podstawie meta-tagów strony — zawsze warto sprawdzić/poprawić przed zapisaniem (dlatego formularz nigdy nie zapisuje automatycznie).
