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

Jeśli Twoja organizacja Google **blokuje tworzenie kluczy kont usług** (komunikat "Key creation is not allowed... organization policies"), skrypt używa zamiast tego Twoich własnych danych logowania Google (Application Default Credentials) — nie wymaga to żadnego pliku klucza:

1. Zainstaluj Google Cloud CLI: https://cloud.google.com/sdk/docs/install
2. W terminalu:
   ```
   gcloud auth application-default login
   gcloud auth application-default set-quota-project toys-for-janek
   cd scripts
   npm install
   node set-admin-claim.js twoj-email@przyklad.pl
   ```
3. Skrypt wypisze potwierdzenie.

(Jeśli Twoja organizacja NIE blokuje kluczy kont usług, możesz zamiast tego pobrać plik JSON z **Project settings → Service accounts → Generate new private key** i zmodyfikować skrypt tak, by użyć `admin.credential.cert(serviceAccount)` — ale w tym repo domyślnie jest skonfigurowane podejście przez ADC, bo działa niezależnie od takich polityk.)

## 6. Klucze API (Google Cloud Console)

Klucz Web API Firebase nie jest tajny w tym sensie, że musi zostać ukryty przed odwiedzającymi stronę (przeglądarka i tak musi go dostać, żeby wywołać Firebase) — ale warto ograniczyć go po "referrer", żeby nie dało się go użyć z innej strony/aplikacji, i **usunąć domyślny, nieograniczony klucz**, żeby nie leżał bezużytecznie. Najszybciej przez `gcloud` (ten sam, którego użyliśmy w kroku 5):

```
gcloud services api-keys list --project=TWOJ_PROJECT_ID

gcloud services api-keys create --display-name="PROJEKT-site-key" --project=TWOJ_PROJECT_ID \
  --allowed-referrers="https://TWOJ-LOGIN.github.io/NAZWA-REPO/*" \
  --api-target=service=identitytoolkit.googleapis.com \
  --api-target=service=firestore.googleapis.com \
  --api-target=service=securetoken.googleapis.com \
  --format="value(response.keyString)"

gcloud services api-keys create --display-name="PROJEKT-extension-key" --project=TWOJ_PROJECT_ID \
  --allowed-referrers="chrome-extension://ID_TWOJEJ_WTYCZKI/*" \
  --api-target=service=identitytoolkit.googleapis.com \
  --api-target=service=firestore.googleapis.com \
  --api-target=service=securetoken.googleapis.com \
  --format="value(response.keyString)"

# na koniec usuń domyślny, nieograniczony klucz auto-utworzony przez Firebase:
gcloud services api-keys delete UID_DOMYSLNEGO_KLUCZA --project=TWOJ_PROJECT_ID
```

(ID wtyczki poznasz dopiero w kroku 8, po wczytaniu jej w Chrome — do tego czasu możesz pominąć tworzenie drugiego klucza albo użyć tymczasowo tego samego co dla strony.)

Zamiast CLI możesz też kliknąć w https://console.cloud.google.com/apis/credentials — "Create credentials → API key", potem "Edit API key" i ustawić te same ograniczenia ręcznie.

## 7. Uzupełnij pliki konfiguracyjne

Dwa pliki, dwa różne podejścia do trzymania klucza — bo wtyczka i strona są wdrażane inaczej:

- **`extension/config.js`** — ten plik **nie jest** trackowany w git (patrz `.gitignore`), bo wtyczka jest ładowana lokalnie z dysku, a nie budowana/wdrażana przez GitHuba, więc sekrety GitHub Actions jej nie dotyczą. Skopiuj `extension/config.example.js` do `extension/config.js` i wpisz tam prawdziwy `apiKey` (klucz ograniczony do wtyczki) oraz `projectId`.
- **`docs/config.js`** — ten plik **jest** w repo, ale z placeholderem `__FIREBASE_SITE_API_KEY__` zamiast prawdziwego klucza. Prawdziwa wartość klucza (ograniczonego do strony) trafia jako sekret repozytorium GitHub — patrz krok 9.

Hasła dla gości NIE ma w żadnym pliku — ustawisz je w panelu admina w kroku 10, żeby nigdy nie trafiło do repozytorium.

## 8. Wczytaj wtyczkę w Chrome

1. Otwórz `chrome://extensions`.
2. Włącz "Tryb dewelopera" (Developer mode) w prawym górnym rogu.
3. "Załaduj rozpakowane" (Load unpacked) → wskaż folder `extension/` z tego repozytorium.
4. Przypnij wtyczkę do paska narzędzi (ikonka puzzli → pinezka obok "Toys for Janek").
5. Zanotuj **ID wtyczki** wyświetlone na karcie — przyda się do ograniczenia klucza API (krok 6).

To rozwiązanie jest do użytku prywatnego/rodzinnego — nie ma potrzeby publikować wtyczki w Chrome Web Store.

## 9. Włącz GitHub Pages (przez GitHub Actions, żeby wstrzyknąć klucz z sekretu)

1. **Dodaj sekret**: w ustawieniach repozytorium **Settings → Secrets and variables → Actions → New repository secret**. Nazwa: `FIREBASE_SITE_API_KEY`, wartość: klucz API strony z kroku 6. Zapisz.
2. **Zmień źródło Pages**: **Settings → Pages → Build and deployment → Source** → ustaw na **"GitHub Actions"** (nie "Deploy from a branch").
3. Wypchnij / zmerguj zmiany do `main` — workflow `.github/workflows/deploy-pages.yml` uruchomi się automatycznie, podmieni placeholder w `docs/config.js` na prawdziwy klucz z sekretu i wdroży stronę. Postęp zobaczysz w zakładce **Actions** repozytorium.
4. Po zakończeniu strona będzie dostępna pod adresem w stylu `https://twoj-login.github.io/toys_for_Janek/`.

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

- Klucz API strony jest wstrzykiwany z sekretu GitHuba dopiero przy wdrożeniu, więc nie ma go w historii gita ani w widoku źródła repo na GitHub.com — ale na już **wdrożonej** stronie, w kodzie JS widocznym w przeglądarce (np. w zakładce Network devtools), i tak jest w pełni widoczny. To nieuniknione dla każdej aplikacji działającej w przeglądarce; nie jest to więc ochrona przed odwiedzającymi stronę, tylko przed wyciekiem przez repozytorium/historię commitów.
- Hasło rodzinne na stronie gościa to bariera kosmetyczna — technicznie zaawansowany gość mógłby je pominąć, wywołując bezpośrednio API Firebase (hash w Firestore jest publicznie odczytywalny, tak jak wcześniej był w kodzie). Prawdziwe zabezpieczenie (App Check / Cloud Functions) wymagałoby płatnego planu Firebase, co było świadomie wykluczone.
- Nie ma limitu częstotliwości rezerwacji (rate limiting) — przy małym gronie rodzinnym to akceptowalne ryzyko.
- Nazwa/cena/zdjęcie wykrywane przez wtyczkę to zgadywanie na podstawie meta-tagów strony — zawsze warto sprawdzić/poprawić przed zapisaniem (dlatego formularz nigdy nie zapisuje automatycznie).
