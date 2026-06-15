// ── MeetLingo Shared UI Translations ─────────────────────────────
// Covers all onboarding + post-meeting pages.
// meeting.html has its own inline UI object — keep it separate.

var ML_UI = {
  English: {
    // name.html
    name_heading:    "What's your first name?",
    name_sub:        'So others can see who is speaking',
    name_placeholder:'Your first name',
    name_btn:        'CONTINUE',
    // login.html
    login_heading:   'Enter your email',
    login_sub:       "We'll send you a 6-digit code",
    login_btn:       'SEND CODE',
    login_helper:    'Check your inbox after tapping',
    // verify.html
    verify_heading:  'Check your email',
    verify_sub:      'We sent a 6-digit code to',
    verify_btn:      'VERIFY CODE',
    verify_resend:   'Resend code',
    // preferences.html
    pref_lang:       'Target Language',
    pref_volume:     'Volume',
    pref_start:      'START LISTENING',
    pref_selected:   'Selected',
    pref_more:       'More languages',
    pref_less:       'Show less',
    // ended.html
    ended_heading:   'Meeting ended — Thank you!',
    ended_rate:      'RATE YOUR EXPERIENCE',
    ended_tap:       'Tap to rate',
    ended_email:     'Send me a meeting summary',
    ended_email_sub: 'Includes AI transcript and action items',
    ended_exit:      'Exit Meeting',
    // common
    back_confirm:    'Leave this page?',
  },
  German: {
    name_heading:    'Wie heißt du?',
    name_sub:        'Damit andere sehen, wer spricht',
    name_placeholder:'Dein Vorname',
    name_btn:        'WEITER',
    login_heading:   'E-Mail eingeben',
    login_sub:       'Wir senden dir einen 6-stelligen Code',
    login_btn:       'CODE SENDEN',
    login_helper:    'Prüfe dein Postfach nach dem Tippen',
    verify_heading:  'E-Mail prüfen',
    verify_sub:      'Wir haben einen 6-stelligen Code gesendet an',
    verify_btn:      'CODE BESTÄTIGEN',
    verify_resend:   'Code erneut senden',
    pref_lang:       'Zielsprache',
    pref_volume:     'Lautstärke',
    pref_start:      'ZUHÖREN STARTEN',
    pref_selected:   'Ausgewählt',
    pref_more:       'Mehr Sprachen',
    pref_less:       'Weniger anzeigen',
    ended_heading:   'Meeting beendet — Danke!',
    ended_rate:      'ERFAHRUNG BEWERTEN',
    ended_tap:       'Zum Bewerten tippen',
    ended_email:     'Meeting-Zusammenfassung senden',
    ended_email_sub: 'Inkl. KI-Transkript und Aufgaben',
    ended_exit:      'Meeting verlassen',
    back_confirm:    'Seite verlassen?',
  },
  Spanish: {
    name_heading:    '¿Cómo te llamas?',
    name_sub:        'Para que otros vean quién habla',
    name_placeholder:'Tu nombre',
    name_btn:        'CONTINUAR',
    login_heading:   'Ingresa tu correo',
    login_sub:       'Te enviaremos un código de 6 dígitos',
    login_btn:       'ENVIAR CÓDIGO',
    login_helper:    'Revisa tu bandeja de entrada',
    verify_heading:  'Revisa tu correo',
    verify_sub:      'Enviamos un código de 6 dígitos a',
    verify_btn:      'VERIFICAR CÓDIGO',
    verify_resend:   'Reenviar código',
    pref_lang:       'Idioma de destino',
    pref_volume:     'Volumen',
    pref_start:      'EMPEZAR A ESCUCHAR',
    pref_selected:   'Seleccionado',
    pref_more:       'Más idiomas',
    pref_less:       'Mostrar menos',
    ended_heading:   '¡Reunión terminada — Gracias!',
    ended_rate:      'VALORA TU EXPERIENCIA',
    ended_tap:       'Toca para valorar',
    ended_email:     'Enviarme un resumen de la reunión',
    ended_email_sub: 'Incluye transcripción IA y tareas',
    ended_exit:      'Salir de la reunión',
    back_confirm:    '¿Salir de esta página?',
  },
  French: {
    name_heading:    'Quel est ton prénom ?',
    name_sub:        'Pour que les autres voient qui parle',
    name_placeholder:'Ton prénom',
    name_btn:        'CONTINUER',
    login_heading:   'Entrez votre e-mail',
    login_sub:       'Nous vous enverrons un code à 6 chiffres',
    login_btn:       'ENVOYER LE CODE',
    login_helper:    'Vérifiez votre boîte de réception',
    verify_heading:  'Vérifiez votre e-mail',
    verify_sub:      'Nous avons envoyé un code à 6 chiffres à',
    verify_btn:      'VÉRIFIER LE CODE',
    verify_resend:   'Renvoyer le code',
    pref_lang:       'Langue cible',
    pref_volume:     'Volume',
    pref_start:      'COMMENCER À ÉCOUTER',
    pref_selected:   'Sélectionné',
    pref_more:       'Plus de langues',
    pref_less:       'Afficher moins',
    ended_heading:   'Réunion terminée — Merci !',
    ended_rate:      'ÉVALUEZ VOTRE EXPÉRIENCE',
    ended_tap:       'Appuyez pour évaluer',
    ended_email:     "M'envoyer un résumé de la réunion",
    ended_email_sub: 'Inclut la transcription IA et les actions',
    ended_exit:      'Quitter la réunion',
    back_confirm:    'Quitter cette page ?',
  },
  Italian: {
    name_heading:    'Come ti chiami?',
    name_sub:        'Così gli altri vedono chi parla',
    name_placeholder:'Il tuo nome',
    name_btn:        'CONTINUA',
    login_heading:   'Inserisci la tua email',
    login_sub:       'Ti invieremo un codice a 6 cifre',
    login_btn:       'INVIA CODICE',
    login_helper:    "Controlla la tua posta in arrivo",
    verify_heading:  'Controlla la tua email',
    verify_sub:      'Abbiamo inviato un codice a 6 cifre a',
    verify_btn:      'VERIFICA CODICE',
    verify_resend:   'Invia di nuovo il codice',
    pref_lang:       'Lingua di destinazione',
    pref_volume:     'Volume',
    pref_start:      'INIZIA AD ASCOLTARE',
    pref_selected:   'Selezionato',
    pref_more:       'Altre lingue',
    pref_less:       'Mostra meno',
    ended_heading:   'Riunione terminata — Grazie!',
    ended_rate:      'VALUTA LA TUA ESPERIENZA',
    ended_tap:       'Tocca per valutare',
    ended_email:     'Inviami un riepilogo della riunione',
    ended_email_sub: 'Include trascrizione AI e azioni',
    ended_exit:      'Esci dalla riunione',
    back_confirm:    'Lasciare questa pagina?',
  },
  Japanese: {
    name_heading:    'お名前は？',
    name_sub:        '誰が話しているかわかるように',
    name_placeholder:'名前',
    name_btn:        '続ける',
    login_heading:   'メールアドレスを入力',
    login_sub:       '6桁のコードをお送りします',
    login_btn:       'コードを送信',
    login_helper:    '受信トレイをご確認ください',
    verify_heading:  'メールを確認してください',
    verify_sub:      '6桁のコードを送信しました：',
    verify_btn:      'コードを確認',
    verify_resend:   'コードを再送',
    pref_lang:       '翻訳先言語',
    pref_volume:     '音量',
    pref_start:      '聴取を開始',
    pref_selected:   '選択中',
    pref_more:       'もっと見る',
    pref_less:       '閉じる',
    ended_heading:   'ミーティング終了 — ありがとう！',
    ended_rate:      '体験を評価する',
    ended_tap:       'タップして評価',
    ended_email:     'ミーティングのまとめを送る',
    ended_email_sub: 'AI文字起こしと議事録を含む',
    ended_exit:      '終了',
    back_confirm:    'このページを離れますか？',
  },
  Portuguese: {
    name_heading:    'Qual é o seu nome?',
    name_sub:        'Para que os outros vejam quem está falando',
    name_placeholder:'Seu primeiro nome',
    name_btn:        'CONTINUAR',
    login_heading:   'Digite seu e-mail',
    login_sub:       'Enviaremos um código de 6 dígitos',
    login_btn:       'ENVIAR CÓDIGO',
    login_helper:    'Verifique sua caixa de entrada',
    verify_heading:  'Verifique seu e-mail',
    verify_sub:      'Enviamos um código de 6 dígitos para',
    verify_btn:      'VERIFICAR CÓDIGO',
    verify_resend:   'Reenviar código',
    pref_lang:       'Idioma de destino',
    pref_volume:     'Volume',
    pref_start:      'COMEÇAR A OUVIR',
    pref_selected:   'Selecionado',
    pref_more:       'Mais idiomas',
    pref_less:       'Mostrar menos',
    ended_heading:   'Reunião encerrada — Obrigado!',
    ended_rate:      'AVALIE SUA EXPERIÊNCIA',
    ended_tap:       'Toque para avaliar',
    ended_email:     'Enviar resumo da reunião',
    ended_email_sub: 'Inclui transcrição de IA e tarefas',
    ended_exit:      'Sair da reunião',
    back_confirm:    'Sair desta página?',
  },
  Turkish: {
    name_heading:    'Adınız ne?',
    name_sub:        'Diğerleri kimin konuştuğunu görsün',
    name_placeholder:'Adınız',
    name_btn:        'DEVAM ET',
    login_heading:   'E-postanızı girin',
    login_sub:       'Size 6 haneli bir kod göndereceğiz',
    login_btn:       'KOD GÖNDER',
    login_helper:    'Gelen kutunuzu kontrol edin',
    verify_heading:  'E-postanızı kontrol edin',
    verify_sub:      '6 haneli kodu gönderdik:',
    verify_btn:      'KODU DOĞRULA',
    verify_resend:   'Kodu tekrar gönder',
    pref_lang:       'Hedef Dil',
    pref_volume:     'Ses',
    pref_start:      'DİNLEMEYE BAŞLA',
    pref_selected:   'Seçildi',
    pref_more:       'Daha fazla dil',
    pref_less:       'Daha az göster',
    ended_heading:   'Toplantı bitti — Teşekkürler!',
    ended_rate:      'DENEYİMİNİZİ DEĞERLENDİRİN',
    ended_tap:       'Değerlendirmek için dokunun',
    ended_email:     'Toplantı özeti gönder',
    ended_email_sub: 'Yapay zeka transkripti dahil',
    ended_exit:      'Toplantıdan çık',
    back_confirm:    'Bu sayfadan ayrılmak istiyor musunuz?',
  },
  Dutch: {
    name_heading:    'Hoe heet je?',
    name_sub:        'Zodat anderen zien wie er spreekt',
    name_placeholder:'Je voornaam',
    name_btn:        'VERDER',
    login_heading:   'Voer je e-mail in',
    login_sub:       'We sturen je een 6-cijferige code',
    login_btn:       'CODE VERSTUREN',
    login_helper:    'Controleer je inbox',
    verify_heading:  'Controleer je e-mail',
    verify_sub:      'We hebben een 6-cijferige code gestuurd naar',
    verify_btn:      'CODE VERIFIËREN',
    verify_resend:   'Code opnieuw versturen',
    pref_lang:       'Doeltaal',
    pref_volume:     'Volume',
    pref_start:      'BEGIN MET LUISTEREN',
    pref_selected:   'Geselecteerd',
    pref_more:       'Meer talen',
    pref_less:       'Minder tonen',
    ended_heading:   'Vergadering beëindigd — Bedankt!',
    ended_rate:      'BEOORDEEL JE ERVARING',
    ended_tap:       'Tik om te beoordelen',
    ended_email:     'Stuur mij een vergaderingsoverzicht',
    ended_email_sub: 'Inclusief AI-transcript en actiepunten',
    ended_exit:      'Vergadering verlaten',
    back_confirm:    'Deze pagina verlaten?',
  },
  Korean: {
    name_heading:    '이름이 무엇인가요?',
    name_sub:        '다른 사람들이 누가 말하는지 알 수 있게요',
    name_placeholder:'이름',
    name_btn:        '계속',
    login_heading:   '이메일을 입력하세요',
    login_sub:       '6자리 코드를 보내드립니다',
    login_btn:       '코드 전송',
    login_helper:    '받은 편지함을 확인하세요',
    verify_heading:  '이메일을 확인하세요',
    verify_sub:      '6자리 코드를 보냈습니다:',
    verify_btn:      '코드 확인',
    verify_resend:   '코드 재전송',
    pref_lang:       '대상 언어',
    pref_volume:     '볼륨',
    pref_start:      '듣기 시작',
    pref_selected:   '선택됨',
    pref_more:       '더 많은 언어',
    pref_less:       '접기',
    ended_heading:   '회의 종료 — 감사합니다!',
    ended_rate:      '경험을 평가해 주세요',
    ended_tap:       '탭하여 평가',
    ended_email:     '회의 요약 보내기',
    ended_email_sub: 'AI 전사 및 실행 항목 포함',
    ended_exit:      '회의 나가기',
    back_confirm:    '이 페이지를 나가시겠습니까?',
  },
  Chinese: {
    name_heading:    '你叫什么名字？',
    name_sub:        '让其他人知道谁在说话',
    name_placeholder:'你的名字',
    name_btn:        '继续',
    login_heading:   '输入您的电子邮件',
    login_sub:       '我们将发送一个6位验证码',
    login_btn:       '发送验证码',
    login_helper:    '请检查您的收件箱',
    verify_heading:  '检查您的电子邮件',
    verify_sub:      '我们已将6位验证码发送至',
    verify_btn:      '验证代码',
    verify_resend:   '重新发送验证码',
    pref_lang:       '目标语言',
    pref_volume:     '音量',
    pref_start:      '开始收听',
    pref_selected:   '已选择',
    pref_more:       '更多语言',
    pref_less:       '收起',
    ended_heading:   '会议结束 — 谢谢！',
    ended_rate:      '评价您的体验',
    ended_tap:       '点击评分',
    ended_email:     '发送会议摘要',
    ended_email_sub: '包含AI转录和行动项目',
    ended_exit:      '退出会议',
    back_confirm:    '确定离开此页面？',
  },
  Arabic: {
    name_heading:    'ما اسمك؟',
    name_sub:        'حتى يرى الآخرون من يتحدث',
    name_placeholder:'اسمك الأول',
    name_btn:        'متابعة',
    login_heading:   'أدخل بريدك الإلكتروني',
    login_sub:       'سنرسل لك رمزاً من 6 أرقام',
    login_btn:       'إرسال الرمز',
    login_helper:    'تحقق من صندوق الوارد',
    verify_heading:  'تحقق من بريدك الإلكتروني',
    verify_sub:      'أرسلنا رمزاً من 6 أرقام إلى',
    verify_btn:      'التحقق من الرمز',
    verify_resend:   'إعادة إرسال الرمز',
    pref_lang:       'اللغة المستهدفة',
    pref_volume:     'الصوت',
    pref_start:      'ابدأ الاستماع',
    pref_selected:   'محدد',
    pref_more:       'المزيد من اللغات',
    pref_less:       'عرض أقل',
    ended_heading:   'انتهى الاجتماع — شكراً!',
    ended_rate:      'قيّم تجربتك',
    ended_tap:       'اضغط للتقييم',
    ended_email:     'إرسال ملخص الاجتماع',
    ended_email_sub: 'يتضمن النص الذكي وبنود العمل',
    ended_exit:      'مغادرة الاجتماع',
    back_confirm:    'هل تريد مغادرة هذه الصفحة؟',
  },
  Russian: {
    name_heading:    'Как тебя зовут?',
    name_sub:        'Чтобы другие видели, кто говорит',
    name_placeholder:'Твоё имя',
    name_btn:        'ПРОДОЛЖИТЬ',
    login_heading:   'Введите ваш email',
    login_sub:       'Мы отправим вам код из 6 цифр',
    login_btn:       'ОТПРАВИТЬ КОД',
    login_helper:    'Проверьте вашу почту',
    verify_heading:  'Проверьте ваш email',
    verify_sub:      'Мы отправили код из 6 цифр на',
    verify_btn:      'ПОДТВЕРДИТЬ КОД',
    verify_resend:   'Отправить код повторно',
    pref_lang:       'Целевой язык',
    pref_volume:     'Громкость',
    pref_start:      'НАЧАТЬ ПРОСЛУШИВАНИЕ',
    pref_selected:   'Выбрано',
    pref_more:       'Ещё языки',
    pref_less:       'Свернуть',
    ended_heading:   'Встреча завершена — Спасибо!',
    ended_rate:      'ОЦЕНИТЕ ОПЫТ',
    ended_tap:       'Нажмите для оценки',
    ended_email:     'Отправить резюме встречи',
    ended_email_sub: 'Включает транскрипт ИИ и задачи',
    ended_exit:      'Выйти из встречи',
    back_confirm:    'Покинуть эту страницу?',
  },
  Polish: {
    name_heading:    'Jak masz na imię?',
    name_sub:        'Żeby inni widzieli, kto mówi',
    name_placeholder:'Twoje imię',
    name_btn:        'DALEJ',
    login_heading:   'Wpisz swój e-mail',
    login_sub:       'Wyślemy ci kod 6-cyfrowy',
    login_btn:       'WYŚLIJ KOD',
    login_helper:    'Sprawdź swoją skrzynkę',
    verify_heading:  'Sprawdź swój e-mail',
    verify_sub:      'Wysłaliśmy kod 6-cyfrowy na adres',
    verify_btn:      'ZWERYFIKUJ KOD',
    verify_resend:   'Wyślij kod ponownie',
    pref_lang:       'Język docelowy',
    pref_volume:     'Głośność',
    pref_start:      'ZACZNIJ SŁUCHAĆ',
    pref_selected:   'Wybrany',
    pref_more:       'Więcej języków',
    pref_less:       'Pokaż mniej',
    ended_heading:   'Spotkanie zakończone — Dziękujemy!',
    ended_rate:      'OCEŃ SWOJE DOŚWIADCZENIE',
    ended_tap:       'Stuknij, aby ocenić',
    ended_email:     'Wyślij mi podsumowanie spotkania',
    ended_email_sub: 'Zawiera transkrypt AI i zadania',
    ended_exit:      'Opuść spotkanie',
    back_confirm:    'Opuścić tę stronę?',
  },
  Swedish: {
    name_heading:    'Vad heter du?',
    name_sub:        'Så att andra ser vem som pratar',
    name_placeholder:'Ditt förnamn',
    name_btn:        'FORTSÄTT',
    login_heading:   'Ange din e-post',
    login_sub:       'Vi skickar en 6-siffrig kod',
    login_btn:       'SKICKA KOD',
    login_helper:    'Kolla din inkorg',
    verify_heading:  'Kolla din e-post',
    verify_sub:      'Vi skickade en 6-siffrig kod till',
    verify_btn:      'VERIFIERA KOD',
    verify_resend:   'Skicka kod igen',
    pref_lang:       'Målspråk',
    pref_volume:     'Volym',
    pref_start:      'BÖRJA LYSSNA',
    pref_selected:   'Vald',
    pref_more:       'Fler språk',
    pref_less:       'Visa mindre',
    ended_heading:   'Mötet avslutades — Tack!',
    ended_rate:      'BETYGSÄTT DIN UPPLEVELSE',
    ended_tap:       'Tryck för att betygsätta',
    ended_email:     'Skicka mig ett mötessammandrag',
    ended_email_sub: 'Inkluderar AI-transkript och åtgärder',
    ended_exit:      'Lämna mötet',
    back_confirm:    'Lämna den här sidan?',
  },
  Hindi: {
    name_heading:    'आपका नाम क्या है?',
    name_sub:        'ताकि दूसरों को पता चले कौन बोल रहा है',
    name_placeholder:'आपका नाम',
    name_btn:        'जारी रखें',
    login_heading:   'अपना ईमेल दर्ज करें',
    login_sub:       'हम आपको 6 अंकों का कोड भेजेंगे',
    login_btn:       'कोड भेजें',
    login_helper:    'अपना इनबॉक्स जांचें',
    verify_heading:  'अपना ईमेल जांचें',
    verify_sub:      'हमने 6 अंकों का कोड भेजा:',
    verify_btn:      'कोड सत्यापित करें',
    verify_resend:   'कोड फिर भेजें',
    pref_lang:       'लक्ष्य भाषा',
    pref_volume:     'वॉल्यूम',
    pref_start:      'सुनना शुरू करें',
    pref_selected:   'चुना गया',
    pref_more:       'अधिक भाषाएं',
    pref_less:       'कम दिखाएं',
    ended_heading:   'बैठक समाप्त — धन्यवाद!',
    ended_rate:      'अपना अनुभव रेट करें',
    ended_tap:       'रेट करने के लिए टैप करें',
    ended_email:     'बैठक सारांश भेजें',
    ended_email_sub: 'AI ट्रांसक्रिप्ट और कार्य शामिल हैं',
    ended_exit:      'बैठक छोड़ें',
    back_confirm:    'इस पेज को छोड़ें?',
  },
  Greek: {
    name_heading:    'Πώς σε λένε;',
    name_sub:        'Για να βλέπουν οι άλλοι ποιος μιλάει',
    name_placeholder:'Το όνομά σου',
    name_btn:        'ΣΥΝΕΧΕΙΑ',
    login_heading:   'Εισάγετε το email σας',
    login_sub:       'Θα σας στείλουμε έναν κωδικό 6 ψηφίων',
    login_btn:       'ΑΠΟΣΤΟΛΗ ΚΩΔΙΚΟΥ',
    login_helper:    'Ελέγξτε τα εισερχόμενά σας',
    verify_heading:  'Ελέγξτε το email σας',
    verify_sub:      'Στείλαμε κωδικό 6 ψηφίων στο',
    verify_btn:      'ΕΠΑΛΗΘΕΥΣΗ ΚΩΔΙΚΟΥ',
    verify_resend:   'Επανάληψη αποστολής',
    pref_lang:       'Γλώσσα προορισμού',
    pref_volume:     'Ένταση',
    pref_start:      'ΕΝΑΡΞΗ ΑΚΡΟΑΣΗΣ',
    pref_selected:   'Επιλεγμένο',
    pref_more:       'Περισσότερες γλώσσες',
    pref_less:       'Εμφάνιση λιγότερων',
    ended_heading:   'Η σύσκεψη τελείωσε — Ευχαριστούμε!',
    ended_rate:      'ΑΞΙΟΛΟΓΗΣΤΕ ΤΗΝ ΕΜΠΕΙΡΙΑ ΣΑΣ',
    ended_tap:       'Πατήστε για αξιολόγηση',
    ended_email:     'Αποστολή περίληψης σύσκεψης',
    ended_email_sub: 'Περιλαμβάνει μεταγραφή ΤΝ',
    ended_exit:      'Έξοδος από σύσκεψη',
    back_confirm:    'Έξοδος από αυτή τη σελίδα;',
  },
  Ukrainian: {
    name_heading:    "Як тебе звати?",
    name_sub:        'Щоб інші бачили, хто говорить',
    name_placeholder:"Твоє ім'я",
    name_btn:        'ПРОДОВЖИТИ',
    login_heading:   'Введіть вашу електронну пошту',
    login_sub:       'Ми надішлемо вам код з 6 цифр',
    login_btn:       'НАДІСЛАТИ КОД',
    login_helper:    'Перевірте вашу поштову скриньку',
    verify_heading:  'Перевірте вашу електронну пошту',
    verify_sub:      'Ми надіслали код з 6 цифр на',
    verify_btn:      'ПІДТВЕРДИТИ КОД',
    verify_resend:   'Надіслати код повторно',
    pref_lang:       'Цільова мова',
    pref_volume:     'Гучність',
    pref_start:      'ПОЧАТИ СЛУХАТИ',
    pref_selected:   'Вибрано',
    pref_more:       'Більше мов',
    pref_less:       'Показати менше',
    ended_heading:   'Зустріч завершена — Дякуємо!',
    ended_rate:      'ОЦІНІТЬ ВАШ ДОСВІД',
    ended_tap:       'Торкніться для оцінки',
    ended_email:     'Надіслати підсумок зустрічі',
    ended_email_sub: 'Включає транскрипт ШІ та завдання',
    ended_exit:      'Вийти зі зустрічі',
    back_confirm:    'Покинути цю сторінку?',
  },
};

// ── Helper ────────────────────────────────────────────────────────
function mlGetLang() {
  return localStorage.getItem('meetlingo_lang') || 'English';
}

function mlT() {
  var lang = mlGetLang();
  return ML_UI[lang] || ML_UI['English'];
}

// ── Logo click → index.html ───────────────────────────────────────
// Call once per page on DOMContentLoaded
function mlWireLogoToHome() {
  document.querySelectorAll('[data-ml-logo]').forEach(function(el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function() {
      window.mlLeaveOk = true;
      window.location.href = 'index.html';
    });
  });
}

// ── beforeunload warning (for pages before meeting starts) ────────
// Set window.mlLeaveOk = true before any intentional navigation to suppress.
function mlWireBeforeUnload() {
  window.mlLeaveOk = false;
  window.addEventListener('beforeunload', function(e) {
    if (window.mlLeaveOk) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

// ── Apply translations to a given page ───────────────────────────
// pageKey: 'name' | 'login' | 'verify' | 'preferences' | 'ended'
function mlApply(pageKey) {
  var t = mlT();
  var $ = function(id) { return document.getElementById(id); };

  if (pageKey === 'name') {
    var h = $('ml-name-heading');    if (h) h.textContent = t.name_heading || "What's your name?";
    var s = $('ml-name-sub');        if (s) s.textContent = t.name_sub || 'So others can see who is speaking';
    var i = $('ml-name-input');      if (i) i.placeholder = t.name_placeholder || 'Your first name';
    var b = $('ml-name-btn');        if (b) b.childNodes[0].textContent = (t.name_btn || 'CONTINUE') + ' ';
  }

  if (pageKey === 'login') {
    var h = $('ml-login-heading');   if (h) h.textContent = t.login_heading;
    var s = $('ml-login-sub');       if (s) s.textContent = t.login_sub;
    var b = $('ml-login-btn');       if (b) b.childNodes[0].textContent = t.login_btn + ' ';
    var f = $('ml-login-helper');    if (f) f.textContent = t.login_helper;
    var p = $('ml-email-input');     if (p) p.placeholder = 'name@example.com';
  }

  if (pageKey === 'verify') {
    var h = $('ml-verify-heading');  if (h) h.textContent = t.verify_heading;
    var s = $('ml-verify-sub');      if (s) {
      var email = localStorage.getItem('meetlingo_email') || 'name@example.com';
      s.innerHTML = t.verify_sub + ' <span class="font-bold text-on-surface">' + email + '</span>';
    }
    var b = $('verify-btn');         if (b) b.childNodes[0].textContent = t.verify_btn + ' ';
    var r = $('ml-verify-resend');   if (r) r.textContent = t.verify_resend;
  }

  if (pageKey === 'preferences') {
    var ls = $('ml-pref-lang');       if (ls) ls.textContent = t.pref_lang;
    var vs = $('ml-pref-volume');     if (vs) vs.textContent = t.pref_volume;
    var vb = $('ml-pref-volume-sub'); if (vb) vb.textContent = t.pref_volume;
    var bt = $('ml-pref-start');      if (bt) bt.textContent = t.pref_start;
    // More-languages toggle label (only update when drawer is closed)
    var ml = $('more-langs-label');
    if (ml && window.moreLangsOpen === false) ml.textContent = t.pref_more || 'More languages';
    // Update selected label text
    var sl = $('selected-lang-label');
    if (sl) {
      var savedLang = localStorage.getItem('meetlingo_lang') || 'Spanish';
      var nativeNames = {
        Spanish:'Español', French:'Français', German:'Deutsch', Italian:'Italiano',
        Japanese:'日本語', English:'English', Portuguese:'Português', Turkish:'Türkçe',
        Dutch:'Nederlands', Korean:'한국어', Chinese:'中文', Arabic:'العربية',
        Russian:'Русский', Polish:'Polski', Swedish:'Svenska', Hindi:'हिन्दी',
        Greek:'Ελληνικά', Ukrainian:'Українська'
      };
      var native = nativeNames[savedLang] || savedLang;
      sl.textContent = t.pref_selected + ': ' + savedLang + ' · ' + native;
    }
  }

  if (pageKey === 'ended') {
    var h  = $('ml-ended-heading');    if (h)  h.textContent  = t.ended_heading;
    var r  = $('ml-ended-rate');       if (r)  r.textContent  = t.ended_rate;
    var tp = $('ml-ended-tap');        if (tp) tp.textContent = t.ended_tap;
    var em = $('ml-ended-email');      if (em) em.textContent = t.ended_email;
    var es = $('ml-ended-email-sub');  if (es) es.textContent = t.ended_email_sub;
    var ex = $('ml-ended-exit');       if (ex) ex.textContent = t.ended_exit;
  }
}
