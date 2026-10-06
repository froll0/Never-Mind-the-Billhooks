# Never Mind the Billhooks — online

Piattaforma web per giocare a **Never Mind the Billhooks** (regole base, *Albion: Guerre delle Due Rose*) a distanza con un amico: tavolo di gioco, unità con le singole basette, carte, segnalini, dadi e applicazione automatica delle regole.

> Progetto amatoriale e non ufficiale. Per giocare serve il manuale *Never Mind the Billhooks* di Andy Callan (Wargames Illustrated). L'app contiene solo una sintesi delle regole scritta per la consultazione rapida.

## Come si gioca a distanza

1. Apri il sito (vedi «Pubblicazione» più sotto) e scrivi il tuo nome.
2. **Crea partita online**: in alto compare il pulsante **Invita** che copia il link. Mandalo all'amico.
3. L'amico apre il link e preme **Unisciti alla partita**.
4. Tieni aperta la pagina finché giocate: la partita "vive" nel browser di chi l'ha creata ed è salvata lì. Se ricarichi la pagina, la partita riprende con lo stesso codice e l'amico si ricollega da solo.

La connessione è diretta tra i due browser (WebRTC tramite il servizio gratuito PeerJS): non serve nessun server da mantenere.

C'è anche la modalità **Gioca in locale** (stesso dispositivo), utile per imparare le regole: l'app passa automaticamente al giocatore che deve agire e permette di annullare l'ultima azione.

## Cosa fa l'app

- **Preparazione**: costruttore d'eserciti con punti e controlli di composizione (Compagnie, formazioni in Linea, Blocco e Blocco misto, Leva/Seguito/Veterani, pali, pavesi, difese campali), Comandanti con classe di comando (anche casuale), Schiere. Gli eserciti si salvano ed esportano in JSON.
- **Terreno**: chi vince il lancio della moneta disegna boschi, colline, paludi, abitati, edifici, siepi, muri, torrenti e staccionate (o li genera a caso); l'altro sceglie il lato.
- **Schieramento** nelle zone corrette (9" dal bordo, lati riservati a Schermagliatori e Cavalleria).
- **Fase di Manovra** alternata, che termina al primo tiro o attacco.
- **Fase di Battaglia** guidata dalle carte: Mazzo di Gioco (Comandanti, Bonus, Schermaglia e Artiglieria), spareggi e mazzo Bonus (Vantaggio, Penalità, Ritira, Evento Speciale, Nessun effetto), Eventi Speciali.
- **Ordini e azioni**: raggio di comando di 6", Segnalini Ordine per classe, due azioni per unità, Schiere e Comandante in Capo.
- **Movimento**: distanze, arco frontale, conversioni, dietro-front, terreno difficile, ostacoli, attraversamento di unità amiche, cariche.
- **Tiro**: arco di 45°, gittate, linea di vista (unità, boschi, siepi e muri, varchi di 4", tiro sopra le teste da un'altura), bersaglio più vicino obbligatorio, frecce, tiri salvezza, coperture, artiglieria ed esplosioni.
- **Mischia**: reazioni (girarsi, sganciarsi, tiro di reazione degli arcieri, contro-carica, riccio di picche), tre round con i rispettivi ritiri, supporto dei blocchi, fianco e retro, comandanti, duelli tra Comandanti in Capo, inseguimenti, cavalleria che rimbalza, mischie che continuano alla prima carta Bonus.
- **Morale**: Test di Crisi del Morale con tutti i ritiri, Scossa e Rotta, ripiegamenti, test per gli amici che vedono una rotta, test di fine turno, gettoni del Morale d'Armata e condizioni di vittoria.
- **Registro** completo con tutti i dadi; la carta **Ritira** si usa direttamente sul lancio.
- **Strumenti manuali** (righello, spostamento libero, modifica di figure, segnalini e Morale d'Armata, note): per le carte o le situazioni che l'app non automatizza. Ogni modifica finisce nel registro.

### Limiti attuali

- Gli **Eventi Speciali** *Imboscata*, *Tradimento*, *Falsi colori* e *Lo stratagemma di Fauconberg*: il loro testo non era leggibile nella copia digitale usata, quindi si applicano a mano (l'Imboscata ha comunque il supporto automatico per l'attacco a sorpresa).
- I **teatri della Deluxe** (Gallia, Bohemia, Helvetia, Italia, Northumbria, Lusitania, Hibernia) e i loro scenari non sono ancora automatizzati: si possono giocare con le truppe base più gli strumenti manuali.

## Pubblicazione (GitHub Pages)

Il workflow `.github/workflows/deploy.yml` esegue i test, compila il sito e lo pubblica a ogni push sul ramo `main`.

1. Su GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Unisci il ramo di sviluppo in `main` (o lancia il workflow a mano da **Actions**).
3. Il sito sarà su `https://<utente>.github.io/Never-Mind-the-Billhooks/`.

## Sviluppo

```bash
npm install
npm run dev           # server di sviluppo
npm test              # test del motore delle regole (inclusi giochi automatici)
npm run build         # sito statico in dist/
npm run build:single  # un unico file HTML in dist-single/ (gioco in locale anche offline)
```

Il server di segnalazione predefinito è quello pubblico di PeerJS. Per usarne uno proprio (per esempio nei test) aggiungi `?peer=host:porta` all'indirizzo.

Struttura:

- `src/engine/` motore delle regole, puro e deterministico (i dadi derivano da un seme, così la carta Ritira può ripetere un singolo lancio);
- `src/net/` connessione peer-to-peer (l'host tiene lo stato autorevole, l'ospite invia le proprie azioni);
- `src/ui/` interfaccia React (tavolo SVG, pannelli);
- `tests/` test con Vitest.
