---
version: 1
slug: "src-app-index-tsx"
primary_target: "src/app/index.tsx"
related_targets: ["src/app"]
---

## Scope

App iOS completa di RePitch Mobile: Libreria, Playlist, dettaglio playlist e Player (modale), più la mini-barra del brano in riproduzione.

**Modalità visitatore:** Operate. L'utente è un musicista, cantante o insegnante che studia o prova con lo strumento in mano.

**Compito:** importare brani, organizzarli in playlist, avviarne uno e sentirlo subito nell'intonazione salvata per quel brano (semitoni, cents, La di riferimento).

**Vincoli:**
- tab bar e stack nativi, sheet, swipe-back sempre attivo;
- target di almeno 44 pt, Dynamic Type;
- interfaccia in italiano, uso offline.

**Direzione fissata dal brief:** "vintage moderno". Carta da musica ingiallita, inchiostro d'incisione, caratteri graziati barocchi ma leggibili, massima usabilità.

**Momento memorabile:** il rigo dell'intonazione nel player e le annotazioni a matita sull'intonazione di ogni brano nelle liste.

## Direction contract

**THESIS**
Un'edizione critica che si suona. Lo strumento di studio porta le convenzioni delle edizioni a stampa: frontespizio, incisione, annotazioni a matita del musicista. Rifiuta il player scuro con copertine e waveform tipico della categoria: qui l'intonazione è il contenuto principale, non un'impostazione nascosta.

**OWN-WORLD**
- **Carta (sfondo):** fondo carta da musica invecchiata #F1E6C8, con grana leggera e piastre a #E8D9B3.
- **Inchiostro (testo):** testo color inchiostro d'incisione #2A2016, testo secondario seppia #6B5A44.
- **Colore d'accento unico:** blu Henle #2C4A7C per tutti gli elementi interattivi.
- **Matita:** grafite #5E5A54 per le annotazioni.
- **Notturno:** fondo noce #1B1510, testo carta #EBDDBA, accento #9DB4DD.
- **Caratteri:**
  - IM Fell English (tipi Fell, anni 1670) per titoli e frontespizi;
  - Libre Caslon Text (Caslon, 1720) per l'interfaccia, con numeri allineati tabulari.
- **Linee e simboli:** filetti da 0,5 pt; simboli musicali disegnati in SVG.

**STORY**
L'utente capisce subito dove sono la libreria e le playlist e quale intonazione ha ogni brano. Si fida che l'intonazione resti salvata. Tocca un brano, alza o abbassa di un semitono e affina i cents, oppure sceglie La 432, e suona.

**FIRST VIEWPORT**
- **Libreria:**
  - titolo grande "Libreria" in Fell, con l'azione Importa a destra;
  - righe a piena larghezza: titolo in Caslon da 17 pt e durata;
  - nel margine destro, l'annotazione a matita dell'intonazione ("+2 · −12¢ · La 432");
  - sopra la tab bar, la mini-barra del brano in riproduzione.
- **Player (sheet):**
  - titolo del brano in Fell;
  - il rigo a cinque linee a tutta larghezza, con la testa di nota sulla trasposizione: è la mossa distintiva;
  - stepper per semitoni e cents, segmenti per il La di riferimento;
  - barra di avanzamento e trasporto in basso, il pulsante play grande.

**FORM**
Mondo fissato dal brief di Teo, che ha dettato le parole: "vintage moderno… foglio musicale antico… colore di sfondo tipo carta da musica vecchia ingiallita… font graziati stile barocco ma ben leggibili… massima usability". Forma scelta: edizione a stampa più annotazione a matita del musicista.

Il giro di concept-seed **non è stato eseguito**. La regola prevede che una direzione fissata dall'utente prevalga sul tiro dei dadi, e questa omissione è dichiarata, non silenziosa. Seed key: nessuna.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Su Android le icone (SF Symbols) e i prompt di sistema (Alert.prompt, ActionSheetIOS) dovranno essere sostituiti in una fase successiva.
- Gli screenshot di verifica dipendono dal simulatore o dal dispositivo di Teo: CoreSimulator non è aggiornato e il sandbox blocca `xcodebuild`.
