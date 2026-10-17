# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

iOS è la prima piattaforma. Android seguirà con la stessa codebase (React Native + Expo) e lo **stesso identico mondo visivo**. Di ciascun sistema si rispettano solo le convenzioni native: back, swipe, safe area, haptics, controlli in lock screen.

## Users

- **Musicisti che studiano:** suonano sopra brani o basi e devono allinearli all'accordatura del proprio strumento, per esempio strumenti storici a La 415 o 432 Hz, oppure strumenti calanti.
- **Cantanti:** trasportano un brano nella propria tonalità per cantarci sopra.
- **Insegnanti e cori:** preparano scalette di brani per lezioni e prove, con l'intonazione salvata per ogni brano.

Usano l'app durante lo studio e le prove. Spesso hanno lo strumento in mano, il telefono appoggiato su un leggio o un tavolo e lo schermo a volte bloccato.

## Product Purpose

RePitch riproduce file audio propri dell'utente cambiandone l'intonazione in tempo reale senza alterarne il tempo. L'intonazione si regola in semitoni e cents, oppure impostando il La di riferimento in Hz, e resta salvata per ogni brano. I brani si organizzano in playlist.

**Successo:** aprire una playlist, toccare un brano e sentirlo subito nella tonalità e accordatura giuste, senza doverle reimpostare.

## Positioning

È lo stesso motore di pitch shifting di alta qualità della versione desktop di RePitch (Signalsmith Stretch, eseguito in nativo). È pensato per l'intonazione musicale, non come un generico cambio di velocità:
- il pitch si regola in semitoni e cents;
- si può impostare il La di riferimento in Hz;
- la memoria per brano consente di preparare una scaletta una volta sola.

## Operating Context

- **Import:** i file si importano dall'app File o dal menu Condividi (mp3, m4a, wav, aiff, flac) e vengono copiati nella sandbox dell'app.
- **Uso senza rete:** funziona totalmente offline, senza account né server.
- **Riproduzione:** l'audio continua in background e a schermo bloccato, con i controlli in lock screen.
- **Contesto d'uso:** sessioni di studio con le mani occupate. Servono target tattili grandi e leggibilità a distanza di braccio.

## Capabilities and Constraints

**Funzioni**
- **Libreria:** brani importati; rinomina ed eliminazione.
- **Playlist:** creare, rinominare, eliminare; aggiungere e rimuovere brani; riordinarli.
- **Player:**
  - play/pausa, avanzamento, brano successivo e precedente;
  - intonazione in **semitoni** (±12) e **cents** (±50);
  - **La di riferimento** in Hz (440 di default; preset 415, 432, 442, 443), convertito internamente in cents: `1200·log2(Hz/440)`.
- **Memoria per brano:** l'intonazione resta salvata per ogni brano, con un ripristino rapido allo 0.

**Vincoli**
- Non si possono importare i brani di Apple Music in streaming né quelli protetti da DRM.
- Nessuna monetizzazione nella v1, ma il conteggio dei secondi ascoltati è già nel motore.
- **Rimandato:** cambio di tempo/velocità e loop A-B.

## Brand Commitments

- **Nome:** RePitch. Lingua dell'interfaccia: **italiano**.
- **Direzione estetica vincolante (data da Teo):** "vintage moderno".
  - foglio musicale antico;
  - sfondo color carta da musica ingiallita;
  - font graziati di gusto barocco ma ben leggibili;
  - massima usabilità.

## Evidence on Hand

- Non esistono testimonianze, utenti o recensioni: non inventarli.
- Non esistono contenuti demo: i brani li porta l'utente.

## Product Principles

1. **L'intonazione è il prodotto.** Pitch, cents e La di riferimento devono essere leggibili a colpo d'occhio e regolabili con precisione, anche con lo strumento in mano.
2. **Prepara una volta, suona sempre.** Quello che l'utente imposta, playlist e intonazione per brano, resta salvato.
3. **Il carattere non deve costare usabilità.** L'estetica vintage vale solo finché target, contrasto e flussi restano impeccabili.
4. **Nessuna sorpresa.** Tutto avviene sul dispositivo: niente account e niente rete.

## Accessibility & Inclusion

- Target tattili di almeno 44 pt.
- Supporto a Dynamic Type.
- Contrasto almeno AA sullo sfondo carta.
- Valori numerici annunciati da VoiceOver con le unità ("più 3 semitoni, meno 12 cents").
