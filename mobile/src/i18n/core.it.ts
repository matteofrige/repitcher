import { SUPPORTED_LABEL } from '../lib/formats';
import { pick } from './platform';

/** Strings of the existing screens. Italian is the source; core.en.ts must match its shape. */
export const core = {
  common: {
    cancel: 'Annulla',
    delete: 'Elimina',
    rename: 'Rinomina',
    save: 'Salva',
    create: 'Crea',
    set: 'Imposta',
    play: 'Riproduci',
    pause: 'Pausa',
    stop: 'Ferma',
    start: 'Avvia',
    close: 'Chiudi',
    retry: 'Riprova',
    nextTrack: 'Brano successivo',
    previousTrack: 'Brano precedente',
    nowPlaying: 'in riproduzione',
    invalidValue: 'Valore non valido',
    select: 'Seleziona',
    done: 'Fine',
    selectAll: 'Seleziona tutto',
    back: 'Indietro',
    ok: 'OK',
    deselectAll: 'Deseleziona tutto',
  },

  errors: {
    unknown: 'Errore sconosciuto',
    load: 'Non riesco ad aprire questo brano.',
    play: 'Non riesco ad avviare la riproduzione.',
    detect: 'Non riesco ad analizzare il La del brano.',
    metronome: 'Non riesco ad avviare il metronomo.',
    micDenied: 'Accesso al microfono negato.',
    tuner: 'Non riesco ad avviare il microfono.',
  },

  /** Note names by pitch: solfège in Italian, letters in English. */
  notation: {
    /** Name of the reference note A. */
    a: 'La',
    /** Reference A and the notes up to the octave above, sharps going up (index = semitones). */
    up: ['La', 'La♯', 'Si', 'Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La'] as string[],
    /** Reference A and the notes down to the octave below, flats going down (index = −semitones). */
    down: ['La', 'La♭', 'Sol', 'Sol♭', 'Fa', 'Mi', 'Mi♭', 'Re', 'Re♭', 'Do', 'Si', 'Si♭', 'La'] as string[],
    /** Tuner: the 12 pitch classes starting from C. */
    pitchClasses: ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'] as string[],
  },

  tabs: {
    tuning: 'Intonazione',
    library: 'Libreria',
    playlists: 'Playlist',
    metronome: 'Metronomo',
    tuner: 'Accordatore',
  },

  tuning: {
    // Tuning tab
    title: 'Intonazione',
    subtitle: 'Vale per tutti i brani, tranne quelli con un’intonazione propria.',
    playingHasOwn: 'Il brano in riproduzione usa un’intonazione propria',
    useGlobal: 'Usa l’intonazione generale',
    useGlobalA11y: 'Usa l’intonazione generale per il brano in riproduzione',
    refTitle: 'Il La del tuo strumento',
    refText:
      'La frequenza a cui è accordato il tuo strumento. RePitch rileva il La di ogni brano e lo adatta in automatico a questo.',
    transposeTitle: 'Trasposizione',
    transposeText: 'Sposta tutti i brani di semitoni, per esempio per suonarli più in basso.',
    fineTitle: 'Accordatura fine',
    fineText: 'Piccola correzione in cents, oltre al La.',
    resetAll: 'Azzera tutto',
    resetAllA11y: 'Azzera tutto: 440 hertz, 0 semitoni, 0 cents',

    // Controls
    unitSemitones: 'semitoni',
    unitCents: 'cents',
    hzMinus: 'Un hertz in meno',
    hzPlus: 'Un hertz in più',
    semitoneMinus: 'Un semitono in meno',
    semitonePlus: 'Un semitono in più',
    centMinus: 'Un cent in meno',
    centPlus: 'Un cent in più',
    refA11y: (hz: number, caption?: string) => `La a ${hz} hertz${caption ? `, ${caption}` : ''}`,
    refValueA11y: (hz: number) => `La a ${hz} hertz`,
    staffLabel: 'Intonazione',
    refLabel: (hz: number) => `La ${hz}`,
    presetCaptions: {
      392: 'barocco francese',
      415: 'barocco',
      430: 'classico',
      465: 'veneziano',
    } as Partial<Record<number, string>>,

    // Formatting helpers
    original: 'originale',
    neutralSpoken: 'intonazione neutra',
    /** Pencil annotation fragment for a non-440 A, e.g. "tuo La 432". */
    annotationRef: (hz: number) => `tuo La ${hz}`,
    /** Word for a semitone count ("semitono"/"semitoni"). */
    semitoneWord: (n: number): string => (Math.abs(n) === 1 ? 'semitono' : 'semitoni'),
    centWord: (n: number): string => (Math.abs(n) === 1 ? 'cent' : 'cents'),
    /** Spoken, e.g. "più 2 semitoni", "meno 1 semitono", "0 semitoni". */
    spokenSemitones: (n: number) =>
      n === 0 ? '0 semitoni' : `${n > 0 ? 'più' : 'meno'} ${Math.abs(n)} ${Math.abs(n) === 1 ? 'semitono' : 'semitoni'}`,
    spokenCents: (n: number) =>
      n === 0 ? '0 cents' : `${n > 0 ? 'più' : 'meno'} ${Math.abs(n)} ${Math.abs(n) === 1 ? 'cent' : 'cents'}`,
    spokenRef: (hz: number) => `il tuo La a ${hz} hertz`,
    /** Caption under the staff. */
    resultOriginal: 'Intonazione originale',
    resultSoundsLike: (note: string) => `Il La suona come ${note}`,
    resultYourA: (hz: number) => `Il tuo La è ${hz} Hz`,
    resultYourAShort: (hz: number) => `tuo La ${hz}`,
    /** Settings a track follows: tail with the user's A. */
    settingsYourA: (hz: number) => `tuo La ${hz} Hz`,
    resultSameAsOriginal: 'Il brano suona come l’originale',
    /** `parts` are already signed values with units, e.g. ["+1 semitono", "−20 cents"]. */
    resultVsOriginal: (parts: string[]) => `Risultato: il brano suona ${parts.join(' e ')} rispetto all’originale`,
  },

  trackNote: {
    manual: (hz: string) => `La del brano ${hz} Hz · manuale`,
    detecting: 'analisi del La…',
    detected: (hz: string) => `La del brano ${hz} Hz · rilevato`,
    uncertain: (hz: string) => `La del brano ≈ ${hz} Hz · incerto, non applicato`,
    notDetected: 'La del brano non rilevato · uso 440 Hz',
    ownTuning: (text: string) => `Intonazione propria: ${text}`,
    ownTuningSpoken: (text: string) => `intonazione propria, ${text}`,
    selected: 'selezionato',
  },

  sourceLa: {
    manual: (hz: string) => `${hz} Hz · manuale`,
    detecting: 'analisi…',
    uncertain: (hz: string) => `≈ ${hz} Hz · incerto`,
    detected: (hz: string) => `${hz} Hz · rilevato`,
    notDetected: '440 Hz · non rilevato',
    chipA11y: (chip: string) => `La del brano: ${chip}. Cambia`,
    sheetTitle: 'La del brano',
    pickDetected: (hz: string) => `Rilevato (${hz} Hz)`,
    pickDetectedUncertain: (hz: string) => `Rilevato ma incerto (≈ ${hz} Hz)`,
    other: 'Altro valore…',
    askTitle: 'Altro valore',
    askBody: (min: number, max: number) => `Il La del brano in Hz, da ${min} a ${max}.`,
    invalidBody: (min: number, max: number) => `Inserisci un numero intero tra ${min} e ${max} Hz.`,
    corrected: (hz: number, signedCents: string) => `Corretto verso il tuo La ${hz}: ${signedCents} cents`,
  },

  library: {
    title: 'Libreria',
    import: 'Importa',
    importA11y: 'Importa brani',
    emptyTitle: 'Nessun brano',
    emptyBody:
      pick(
        `Importa file audio dall’app File (${SUPPORTED_LABEL}). I brani di Apple Music protetti non sono supportati.`,
        `Importa file audio da Gestione file (${SUPPORTED_LABEL}). I brani protetti da DRM non sono supportati.`,
      ),
    formatsFooter: `Formati supportati: ${SUPPORTED_LABEL}`,
    importUnsupportedTitle: 'Formato non supportato',
    importUnsupportedBody: (names: string[]) =>
      `Questi file non sono stati importati perché RePitch non riesce a riprodurli: ${names.join(', ')}.\n\nFormati supportati: ${SUPPORTED_LABEL}.`,
    emptyAction: 'Importa brani',
    importPartialTitle: 'Alcuni file non sono stati importati',
    importPartialBody: (failed: string[]) =>
      `Non sono riuscito a copiare: ${failed.join(', ')}. Controlla che i file siano scaricati sul dispositivo e riprova ${pick('dall’app File', 'da Gestione file')}.`,
    importFailedTitle: 'Importazione non riuscita',
    importFailedBody: (reason: string) => `${reason}. Riprova, oppure scegli i file ${pick('dall’app File', 'da Gestione file')}.`,
    actionsFor: (title: string) => `Azioni per ${title}`,
    fromLibrary: 'Dalla libreria',
    searchPlaceholder: 'Cerca nella libreria',
    searchClear: 'Cancella ricerca',
    searchNoResults: (q: string) => `Nessun brano per «${q}»`,
    selectA11y: 'Seleziona più brani',
    selectedCount: (n: number) => (n === 0 ? 'Nessuno selezionato' : n === 1 ? '1 selezionato' : `${n} selezionati`),
    bulkAddToPlaylist: 'Aggiungi a playlist',
  },

  playlists: {
    title: 'Playlist',
    new: 'Nuova',
    newA11y: 'Nuova playlist',
    emptyTitle: 'Nessuna playlist',
    emptyBody: 'Raggruppa i brani in scalette per le prove: l’intonazione di ogni brano resta salvata.',
    emptyAction: 'Crea una playlist',
    actionsFor: (name: string) => `Azioni per ${name}`,
    tracks: (n: number) => `${n} ${n === 1 ? 'brano' : 'brani'}`,
    minutes: (m: number) => `${m} min`,
    fromPlaylist: (name: string) => `Dalla playlist ${name}`,
    // Detail
    edit: 'Modifica',
    editDone: 'Fine',
    editA11y: 'Modifica ordine',
    editDoneA11y: 'Fine modifica',
    add: 'Aggiungi',
    detailEmpty: 'La playlist è vuota. Tocca «Aggiungi» per scegliere i brani dalla libreria.',
    moveUp: (title: string) => `Sposta su ${title}`,
    moveDown: (title: string) => `Sposta giù ${title}`,
    dragA11y: (title: string) => `Trascina per spostare ${title}`,
    sortByName: 'Ordina per nome',
    remove: (title: string) => `Rimuovi ${title} dalla playlist`,
    // Add sheet
    addTracksTitle: 'Aggiungi brani',
    addCount: (n: number) => `Aggiungi (${n})`,
    libraryEmpty: 'La libreria è vuota. Importa prima qualche brano.',
    allAdded: 'Tutti i brani della libreria sono già in questa playlist.',
    addToPlaylistTitle: 'Aggiungi a playlist',
    newEllipsis: 'Nuova playlist…',
    already: 'Già presente',
    alreadyA11y: (name: string) => `${name}, già presente`,
    moveToPlaylistTitle: 'Sposta in playlist',
    tracksCount: (n: number) => (n === 1 ? '1 brano' : `${n} brani`),
    bulkMove: 'Sposta',
    bulkCopy: 'Aggiungi a…',
    bulkRemove: 'Rimuovi',
    moveToTop: 'In cima',
    moveToBottom: 'In fondo',
    moveToOther: 'In un’altra playlist…',
  },

  prompts: {
    newPlaylistTitle: 'Nuova playlist',
    newPlaylistMessage: 'Dai un nome alla scaletta.',
    renameTrackTitle: 'Rinomina brano',
    renamePlaylistTitle: 'Rinomina playlist',
    deleteTrackTitle: (title: string) => `Eliminare «${title}»?`,
    deleteTrackMessage: 'Il file verrà rimosso dall’app e da tutte le playlist. Non si può annullare.',
    deleteTracksTitle: (n: number) => (n === 1 ? 'Eliminare 1 brano?' : `Eliminare ${n} brani?`),
    deleteTracksMessage: 'I file verranno rimossi dall’app e da tutte le playlist. Non si può annullare.',
    deletePlaylistTitle: (name: string) => `Eliminare la playlist «${name}»?`,
    deletePlaylistMessage: 'I brani restano nella libreria.',
    addToPlaylist: 'Aggiungi a playlist…',
  },

  player: {
    ownSettings: 'Questo brano ha un’intonazione propria',
    globalSettings: 'Questo brano usa l’intonazione generale',
    backToGlobal: 'Torna all’intonazione generale',
    backToGlobalA11y: 'Torna all’intonazione generale per questo brano',
    sourceTitle: 'Il La di questo brano',
    sourceText: (hz: number) => `RePitch lo porta al tuo La (${hz} Hz).`,
    transposeTitle: 'Trasposizione (solo questo brano)',
    transposeText: 'Modificarla dà a questo brano un’intonazione propria.',
    fineTitle: 'Accordatura fine (solo questo brano)',
    fineText: 'Piccola correzione in cents, oltre al La. Dà a questo brano un’intonazione propria.',
    position: 'Posizione',
    positionValue: (shown: string, total: string) => `${shown} di ${total}`,
    miniA11y: (title: string) => `In riproduzione: ${title}. Apri il player`,
    dockHint: 'Tocca il brano qui sotto per regolarne l’intonazione',
    dockHintA11y: 'Tocca il brano qui sotto per regolarne l’intonazione. Apre il player',
  },

  metronome: {
    title: 'Metronomo',
    dockLabel: (bpm: number) => `Metronomo ${bpm} BPM`,
    stopA11y: 'Ferma il metronomo',
    startA11y: 'Avvia il metronomo',
    askTitle: 'Tempo (BPM)',
    askBody: (min: number, max: number) => `BPM da ${min} a ${max}.`,
    invalidBody: (min: number, max: number) => `Inserisci un numero tra ${min} e ${max}.`,
    bpmA11y: (bpm: number) => `${bpm} battiti al minuto`,
    bpmMinus: 'Un battito al minuto in meno',
    bpmPlus: 'Un battito al minuto in più',
    tempo: 'Tempo',
    setValueA11y: 'Scrivi il valore dei BPM',
    setValueLink: 'Scrivi un valore…',
    beatsPerBar: 'Battiti per misura',
    beatsA11y: (n: number) => `${n} ${n === 1 ? 'battito' : 'battiti'} per misura`,
    volume: (v: number) => `Volume ${v}%`,
    volumeLabel: 'Volume del metronomo',
    volumeSpoken: (v: number) => `${v} per cento`,
    flash: 'Lampeggia sul battito',
  },

  tuner: {
    title: 'Accordatore',
    deniedBody: pick(
      'Per usare l’accordatore consenti l’accesso al microfono in Impostazioni › RePitch.',
      'Per usare l’accordatore consenti l’accesso al microfono nelle impostazioni di Android, in App › RePitch › Autorizzazioni.',
    ),
    openSettings: 'Apri Impostazioni',
    micError: 'Non riesco ad avviare il microfono. Riprova tra poco.',
    playNote: 'Suona una nota',
    noSignalA11y: 'Nessun segnale. Suona una nota',
    readingA11y: (name: string, octave: number, verdict: string, hz: string) => `${name} ${octave}, ${verdict}, ${hz} hertz`,
    inTune: 'intonato',
    sharp: (signedCents: string) => `crescente · ${signedCents} cents`,
    flat: (signedCents: string) => `calante · ${signedCents} cents`,
    /** Frequency readout with one decimal and the locale's decimal separator. */
    frequency: (hz: number) => `${hz.toFixed(1).replace('.', ',')} Hz`,
    /** Plain number for the spoken label. */
    frequencySpoken: (hz: number) => hz.toFixed(1),
    targetTitle: 'Nota bersaglio',
    auto: 'Automatica',
    tonePlay: (note: string, hz: string) => `Suona ${note} · ${hz}`,
    toneStop: 'Ferma la nota',
    toneHint: 'Nota di riferimento all’ottava centrale, accordata sul tuo La.',
    referenceInfo: (hz: number) => `Il tuo La: ${hz} Hz · si cambia in Intonazione`,
  },
};
export type CoreStrings = typeof core;
