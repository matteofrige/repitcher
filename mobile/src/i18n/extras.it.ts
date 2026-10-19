import { pick } from './platform';

/** Strings of guide, about, rating and notifications. Italian is the source; extras.en.ts must match. */
export const extras = {
  guide: {
    skip: 'Salta',
    next: 'Avanti',
    start: 'Inizia',
    pageOf: (n: number, total: number) => `Pagina ${n} di ${total}`,
    pages: [
      {
        title: 'Benvenuto in RePitch',
        text: 'RePitch accorda le tue registrazioni al tuo strumento, così puoi suonare insieme a qualsiasi brano.',
      },
      {
        title: 'Il La del tuo strumento',
        text: 'In Intonazione imposta la frequenza a cui è accordato il tuo strumento, per esempio 442 Hz. Vale per tutti i brani; puoi anche trasporre per semitoni e regolare di qualche cents.',
      },
      {
        title: 'Importa i brani',
        text: pick(
          'In Libreria tocca «Importa» per aggiungere file audio dall’app File. RePitch rileva da solo il La di ogni brano e lo allinea al tuo.',
          'In Libreria tocca «Importa» per aggiungere file audio da Gestione file. RePitch rileva da solo il La di ogni brano e lo allinea al tuo.',
        ),
      },
      {
        title: 'Solo questo brano',
        text: 'Apri un brano nel lettore per dargli un’intonazione tutta sua. Tutti gli altri brani restano sull’intonazione generale.',
      },
      {
        title: 'Per le tue prove',
        text: 'Playlist per organizzare le prove, riproduzione anche a schermo bloccato, più metronomo e accordatore (con i temperamenti storici, se vuoi accordare oltre l’equabile).',
      },
    ],
  },
  about: {
    title: 'Informazioni',
    done: 'Fine',
    openLabel: 'Informazioni su RePitch',
    version: (v: string) => `Versione ${v}`,
    description:
      'RePitch riproduce i tuoi file audio accordandoli al tuo strumento. È fatta da una sola persona, Matteo Frigé, per i musicisti che studiano con le registrazioni.',
    privacyLine:
      'Nessun account, nessun tracciamento: i tuoi file restano sul tuo dispositivo.',
    helpHeader: 'Aiutaci a migliorare',
    suggest: 'Suggerisci un miglioramento',
    report: 'Segnala un problema',
    rate: 'Valuta RePitch',
    guideHeader: 'Guida',
    reviewGuide: 'Rivedi la guida',
    dataHeader: 'I tuoi dati',
    backupRow: 'Backup delle impostazioni',
    privacyHeader: 'Privacy',
    privacyPolicy: 'Informativa sulla privacy',
    creditsHeader: 'Riconoscimenti',
    audioEngine: 'Motore audio',
    audioEngineValue: 'Signalsmith Stretch, di Signalsmith Audio (licenza MIT)',
    licenseHide: 'Nascondi la licenza',
    licenseShow: 'Mostra la licenza',
    fontsLabel: 'Caratteri tipografici',
    fonts: [
      'IM Fell English — Igino Marini',
      'Libre Caslon Text — Pablo Impallari, Rodrigo Fuenzalida',
      'Noto Music — Google',
    ],
    fontsLicense: 'Tutti con licenza SIL Open Font License 1.1.',
  },
  backup: {
    title: 'Backup',
    done: 'Fine',
    intro: pick(
      'Le tue impostazioni si salvano da sole su questo iPhone (e finiscono nel backup iCloud dell’iPhone, se è attivo). Qui puoi salvarne una copia su iCloud Drive o altrove, per esempio per passare a un nuovo iPhone. I file audio non sono inclusi: dopo il ripristino reimportali e le loro impostazioni torneranno da sole.',
      'Le tue impostazioni si salvano da sole su questo telefono. Qui puoi salvarne una copia su Google Drive o altrove, per esempio per passare a un nuovo telefono. I file audio non sono inclusi: dopo il ripristino reimportali e le loro impostazioni torneranno da sole.',
    ),
    export: 'Esporta backup',
    restore: 'Ripristina da backup',
    shareTitle: 'Backup di RePitch',
    confirmTitle: 'Ripristinare il backup?',
    confirmMessage:
      'Il tuo La, la trasposizione, le impostazioni dei brani e le playlist verranno sostituiti con quelli del backup.',
    cancel: 'Annulla',
    confirm: 'Ripristina',
    doneTitle: 'Backup ripristinato',
    report: (matched: number, pending: number) =>
      `Ripristinato. ${matched} ${matched === 1 ? 'brano abbinato' : 'brani abbinati'}` +
      (pending > 0
        ? `; ${pending} in attesa: importa ${pending === 1 ? 'quel file e le sue impostazioni verranno applicate da sole' : 'quei file e le loro impostazioni verranno applicate da sole'}.`
        : '.'),
    errorTitle: 'Operazione non riuscita',
    errorInvalid: 'Questo file non è un backup di RePitch.',
    errorRead: 'Non riesco a leggere il file.',
    errorShare: 'Non riesco a condividere il backup su questo dispositivo.',
    ok: 'OK',
    pendingTitle: (n: number) => (n === 1 ? '1 brano in attesa' : `${n} brani in attesa`),
    pendingBody: 'Importa questi file e le loro impostazioni verranno applicate da sole:',
    andOthers: (n: number) => `e altri ${n}`,
    forget: 'Dimentica',
    forgetA11y: 'Dimentica i brani in attesa',
    forgetTitle: 'Dimenticare i brani in attesa?',
    forgetMessage: 'Le loro impostazioni salvate nel backup non verranno più applicate quando li importi.',
  },
  feedback: {
    suggestionSubject: 'RePitch – suggerimento',
    suggestionHint: 'Scrivi qui il tuo suggerimento.',
    problemSubject: 'RePitch – segnalazione',
    problemHint: 'Cosa è successo? Cosa ti aspettavi?',
    footerApp: 'App',
    footerOs: pick('iOS', 'Android'),
    footerLanguage: 'Lingua',
    noMailTitle: 'Posta non disponibile',
    noMailMessage: (email: string) =>
      `Non riesco ad aprire ${pick('l’app Mail', 'un’app di posta')}. Scrivici a ${email}.`,
    copyAddress: 'Copia indirizzo',
    cancel: 'Annulla',
  },
};
export type ExtrasStrings = typeof extras;
