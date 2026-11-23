// AI voice receptionist: phone-call appointment booking with a per-doctor daily token, in English,
// Tamil, Telugu, Kannada, Malayalam and Hindi. Pure dialogue logic; database access is injected (ctx),
// so the same engine drives the phone line (Twilio webhook) and the portal's browser demo.
//
// Flow: language → need (doctor / department / symptom) → doctor (if several) → day → slot →
//       patient (caller-ID match or name) → confirm → book → token number (WhatsApp follows).
// ponytail: translations are written for clarity, not reviewed by native speakers; have each
// language checked before going live.

export const LANGS = ['en', 'ta', 'te', 'kn', 'ml', 'hi'];
export const LOCALE = { en: 'en-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', hi: 'hi-IN' };

const P = {
  menu: {
    en: 'Welcome to {hospital}. For English, press 1.',
    ta: 'தமிழுக்கு 2 அழுத்தவும்.',
    te: 'తెలుగు కోసం 3 నొక్కండి.',
    kn: 'ಕನ್ನಡಕ್ಕಾಗಿ 4 ಒತ್ತಿರಿ.',
    ml: 'മലയാളത്തിന് 5 അമർത്തുക.',
    hi: 'हिंदी के लिए 6 दबाइए।',
  },
  askNeed: {
    en: 'Which doctor or department do you need? You can also tell me your problem, like fever or knee pain.',
    ta: 'எந்த மருத்துவர் அல்லது பிரிவு வேண்டும்? காய்ச்சல், மூட்டு வலி போன்ற உங்கள் பிரச்சனையையும் சொல்லலாம்.',
    te: 'మీకు ఏ డాక్టర్ లేదా విభాగం కావాలి? జ్వరం, మోకాలి నొప్పి వంటి మీ సమస్యను కూడా చెప్పవచ్చు.',
    kn: 'ನಿಮಗೆ ಯಾವ ವೈದ್ಯರು ಅಥವಾ ವಿಭಾಗ ಬೇಕು? ಜ್ವರ, ಮೊಣಕಾಲು ನೋವು ಮುಂತಾದ ನಿಮ್ಮ ಸಮಸ್ಯೆಯನ್ನೂ ಹೇಳಬಹುದು.',
    ml: 'ഏത് ഡോക്ടറെയോ വിഭാഗത്തെയോ ആണ് വേണ്ടത്? പനി, മുട്ടുവേദന പോലുള്ള നിങ്ങളുടെ പ്രശ്നവും പറയാം.',
    hi: 'आपको कौन से डॉक्टर या विभाग चाहिए? आप अपनी समस्या भी बता सकते हैं, जैसे बुखार या घुटने का दर्द।',
  },
  sorry: {
    en: "Sorry, I didn't catch that.", ta: 'மன்னிக்கவும், புரியவில்லை.', te: 'క్షమించండి, అర్థం కాలేదు.',
    kn: 'ಕ್ಷಮಿಸಿ, ಅರ್ಥವಾಗಲಿಲ್ಲ.', ml: 'ക്ഷമിക്കണം, മനസ്സിലായില്ല.', hi: 'माफ़ कीजिए, समझ नहीं आया।',
  },
  chooseDoctor: {
    en: 'In {dept} we have: {list}. Say or press the number.', ta: '{dept} பிரிவில்: {list}. எண்ணைச் சொல்லுங்கள் அல்லது அழுத்துங்கள்.',
    te: '{dept} విభాగంలో: {list}. నంబర్ చెప్పండి లేదా నొక్కండి.', kn: '{dept} ವಿಭಾಗದಲ್ಲಿ: {list}. ಸಂಖ್ಯೆ ಹೇಳಿ ಅಥವಾ ಒತ್ತಿರಿ.',
    ml: '{dept} വിഭാഗത്തിൽ: {list}. നമ്പർ പറയൂ അല്ലെങ്കിൽ അമർത്തൂ.', hi: '{dept} विभाग में: {list}. नंबर बोलिए या दबाइए।',
  },
  askDay: {
    en: '{doctor}. Today, tomorrow, or the day after? Press 1, 2 or 3.', ta: '{doctor}. இன்று, நாளை, அல்லது நாளை மறுநாள்? 1, 2 அல்லது 3 அழுத்தவும்.',
    te: '{doctor}. ఈ రోజు, రేపు, లేదా ఎల్లుండి? 1, 2 లేదా 3 నొక్కండి.', kn: '{doctor}. ಇಂದು, ನಾಳೆ, ಅಥವಾ ನಾಡಿದ್ದು? 1, 2 ಅಥವಾ 3 ಒತ್ತಿರಿ.',
    ml: '{doctor}. ഇന്ന്, നാളെ, അല്ലെങ്കിൽ മറ്റന്നാൾ? 1, 2 അല്ലെങ്കിൽ 3 അമർത്തുക.', hi: '{doctor}. आज, कल, या परसों? 1, 2 या 3 दबाइए।',
  },
  noSlots: {
    en: 'No free slots that day. Please choose another day.', ta: 'அன்று இடம் இல்லை. வேறு நாளைத் தேர்ந்தெடுக்கவும்.',
    te: 'ఆ రోజు ఖాళీ స్లాట్లు లేవు. వేరే రోజు ఎంచుకోండి.', kn: 'ಆ ದಿನ ಸ್ಲಾಟ್ ಖಾಲಿ ಇಲ್ಲ. ಬೇರೆ ದಿನ ಆಯ್ಕೆಮಾಡಿ.',
    ml: 'ആ ദിവസം ഒഴിവില്ല. മറ്റൊരു ദിവസം തിരഞ്ഞെടുക്കൂ.', hi: 'उस दिन कोई स्लॉट खाली नहीं है। कृपया दूसरा दिन चुनें।',
  },
  chooseSlot: {
    en: 'Available times: {list}. Say or press the number.', ta: 'கிடைக்கும் நேரங்கள்: {list}. எண்ணைச் சொல்லுங்கள் அல்லது அழுத்துங்கள்.',
    te: 'అందుబాటులో ఉన్న సమయాలు: {list}. నంబర్ చెప్పండి లేదా నొక్కండి.', kn: 'ಲಭ್ಯವಿರುವ ಸಮಯಗಳು: {list}. ಸಂಖ್ಯೆ ಹೇಳಿ ಅಥವಾ ಒತ್ತಿರಿ.',
    ml: 'ലഭ്യമായ സമയങ്ങൾ: {list}. നമ്പർ പറയൂ അല്ലെങ്കിൽ അമർത്തൂ.', hi: 'उपलब्ध समय: {list}. नंबर बोलिए या दबाइए।',
  },
  isPatient: {
    en: 'Is this appointment for {name}? Say yes or no.', ta: 'இந்த முன்பதிவு {name} அவர்களுக்கா? ஆம் அல்லது இல்லை சொல்லுங்கள்.',
    te: 'ఈ అపాయింట్‌మెంట్ {name} కోసమేనా? అవును లేదా కాదు చెప్పండి.', kn: 'ಈ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ {name} ಅವರಿಗಾ? ಹೌದು ಅಥವಾ ಇಲ್ಲ ಹೇಳಿ.',
    ml: 'ഈ ബുക്കിംഗ് {name}-ന് ആണോ? അതെ അല്ലെങ്കിൽ അല്ല എന്ന് പറയൂ.', hi: 'क्या यह अपॉइंटमेंट {name} के लिए है? हाँ या नहीं बोलिए।',
  },
  askName: {
    en: "Please say the patient's name.", ta: 'நோயாளியின் பெயரைச் சொல்லுங்கள்.', te: 'రోగి పేరు చెప్పండి.',
    kn: 'ರೋಗಿಯ ಹೆಸರು ಹೇಳಿ.', ml: 'രോഗിയുടെ പേര് പറയൂ.', hi: 'कृपया मरीज़ का नाम बताइए।',
  },
  confirm: {
    en: 'Booking {name} with {doctor}, {day} at {time}. Shall I confirm? Say yes or no.',
    ta: '{name} அவர்களுக்கு {doctor} உடன் {day} {time} மணிக்கு முன்பதிவு. உறுதி செய்யவா? ஆம் அல்லது இல்லை.',
    te: '{name} గారికి {doctor} వద్ద {day} {time}కి అపాయింట్‌మెంట్. నిర్ధారించమంటారా? అవును లేదా కాదు.',
    kn: '{name} ಅವರಿಗೆ {doctor} ಅವರೊಂದಿಗೆ {day} {time}ಕ್ಕೆ ಬುಕ್ಕಿಂಗ್. ದೃಢೀಕರಿಸಲೇ? ಹೌದು ಅಥವಾ ಇಲ್ಲ.',
    ml: '{name}-ന് {doctor}-യുമായി {day} {time}-ന് ബുക്കിംഗ്. ഉറപ്പിക്കട്ടെ? അതെ അല്ലെങ്കിൽ അല്ല.',
    hi: '{name} के लिए {doctor} के साथ {day} {time} बजे अपॉइंटमेंट. पक्का करूँ? हाँ या नहीं।',
  },
  booked: {
    en: 'Confirmed. Your token number is {token}. You will get the details on WhatsApp. Thank you.',
    ta: 'உறுதி செய்யப்பட்டது. உங்கள் டோக்கன் எண் {token}. விவரங்கள் வாட்ஸ்அப்பில் வரும். நன்றி.',
    te: 'నిర్ధారించబడింది. మీ టోకెన్ నంబర్ {token}. వివరాలు వాట్సాప్‌లో వస్తాయి. ధన్యవాదాలు.',
    kn: 'ದೃಢೀಕರಿಸಲಾಗಿದೆ. ನಿಮ್ಮ ಟೋಕನ್ ಸಂಖ್ಯೆ {token}. ವಿವರಗಳು ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಬರುತ್ತವೆ. ಧನ್ಯವಾದಗಳು.',
    ml: 'ഉറപ്പിച്ചു. നിങ്ങളുടെ ടോക്കൺ നമ്പർ {token}. വിവരങ്ങൾ വാട്ട്‌സ്ആപ്പിൽ ലഭിക്കും. നന്ദി.',
    hi: 'पक्का हो गया। आपका टोकन नंबर {token} है। जानकारी व्हाट्सऐप पर मिलेगी। धन्यवाद।',
  },
  restart: {
    en: "Okay, let's start again.", ta: 'சரி, மீண்டும் தொடங்கலாம்.', te: 'సరే, మళ్ళీ మొదలుపెడదాం.',
    kn: 'ಸರಿ, ಮತ್ತೆ ಆರಂಭಿಸೋಣ.', ml: 'ശരി, വീണ്ടും തുടങ്ങാം.', hi: 'ठीक है, फिर से शुरू करते हैं।',
  },
  taken: {
    en: 'Sorry, that time was just taken.', ta: 'மன்னிக்கவும், அந்த நேரம் இப்போது பதிவாகிவிட்டது.', te: 'క్షమించండి, ఆ సమయం ఇప్పుడే బుక్ అయింది.',
    kn: 'ಕ್ಷಮಿಸಿ, ಆ ಸಮಯ ಈಗಷ್ಟೇ ಬುಕ್ ಆಗಿದೆ.', ml: 'ക്ഷമിക്കണം, ആ സമയം ഇപ്പോൾ ബുക്ക് ആയി.', hi: 'माफ़ कीजिए, वह समय अभी बुक हो गया।',
  },
  handoff: {
    en: 'Let me connect you to our reception.', ta: 'எங்கள் வரவேற்பாளருடன் இணைக்கிறேன்.', te: 'మా రిసెప్షన్‌కి కలుపుతున్నాను.',
    kn: 'ನಮ್ಮ ರಿಸೆಪ್ಷನ್‌ಗೆ ಸಂಪರ್ಕಿಸುತ್ತಿದ್ದೇನೆ.', ml: 'ഞങ്ങളുടെ റിസപ്ഷനിലേക്ക് കണക്ട് ചെയ്യുന്നു.', hi: 'आपको रिसेप्शन से जोड़ रहा हूँ।',
  },
  callback: {
    en: 'Our staff will call you back shortly. Thank you.', ta: 'எங்கள் ஊழியர்கள் விரைவில் உங்களை அழைப்பார்கள். நன்றி.',
    te: 'మా సిబ్బంది త్వరలో మీకు కాల్ చేస్తారు. ధన్యవాదాలు.', kn: 'ನಮ್ಮ ಸಿಬ್ಬಂದಿ ಶೀಘ್ರದಲ್ಲೇ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತಾರೆ. ಧನ್ಯವಾದಗಳು.',
    ml: 'ഞങ്ങളുടെ ജീവനക്കാർ ഉടൻ തിരികെ വിളിക്കും. നന്ദി.', hi: 'हमारा स्टाफ जल्द ही आपको कॉल करेगा। धन्यवाद।',
  },
};

const DAYS = {
  en: ['today', 'tomorrow', 'the day after tomorrow'], ta: ['இன்று', 'நாளை', 'நாளை மறுநாள்'], te: ['ఈ రోజు', 'రేపు', 'ఎల్లుండి'],
  kn: ['ಇಂದು', 'ನಾಳೆ', 'ನಾಡಿದ್ದು'], ml: ['ഇന്ന്', 'നാളെ', 'മറ്റന്നാൾ'], hi: ['आज', 'कल', 'परसों'],
};

// ---- understanding (keywords across all six languages; speech engines return native script) ----
const NUMBERS = [
  ['1', 'one', 'first', 'ஒன்று', 'ஒண்ணு', 'ఒకటి', 'ಒಂದು', 'ഒന്ന്', 'एक'],
  ['2', 'two', 'second', 'இரண்டு', 'ரெண்டு', 'రెండు', 'ಎರಡು', 'രണ്ട്', 'दो'],
  ['3', 'three', 'third', 'மூன்று', 'மூணு', 'మూడు', 'ಮೂರು', 'മൂന്ന്', 'तीन'],
  ['4', 'four', 'fourth', 'நான்கு', 'நாலு', 'నాలుగు', 'ನಾಲ್ಕು', 'നാല്', 'चार'],
  ['5', 'five', 'fifth', 'ஐந்து', 'அஞ்சு', 'ఐదు', 'ಐದು', 'അഞ്ച്', 'पांच', 'पाँच'],
  ['6', 'six', 'sixth', 'ஆறு', 'ఆరు', 'ಆರು', 'ആറ്', 'छह', 'छः'],
];
const YES = ['yes', 'yeah', 'yep', 'ok', 'okay', 'confirm', 'sure', 'ஆம்', 'ஆமா', 'சரி', 'ஓகே', 'అవును', 'సరే', 'ఓకే', 'ಹೌದು', 'ಸರಿ', 'ಓಕೆ', 'അതെ', 'ശരി', 'ഓക്കേ', 'हाँ', 'हां', 'जी', 'ठीक'];
const NO = ['no', 'nope', 'cancel', 'wrong', 'இல்லை', 'வேண்டாம்', 'కాదు', 'వద్దు', 'లేదు', 'ಇಲ್ಲ', 'ಬೇಡ', 'അല്ല', 'വേണ്ട', 'ഇല്ല', 'नहीं', 'ना'];
const DAY_WORDS = [
  [2, ['day after', 'மறுநாள்', 'ఎల్లుండి', 'ನಾಡಿದ್ದು', 'മറ്റന്നാൾ', 'परसों']], // before "tomorrow": நாளை மறுநாள் contains நாளை
  [1, ['tomorrow', 'நாளை', 'రేపు', 'ನಾಳೆ', 'നാളെ', 'कल']],
  [0, ['today', 'இன்று', 'இன்னைக்கு', 'ఈ రోజు', 'ఈరోజు', 'ಇಂದು', 'ಇವತ್ತು', 'ഇന്ന്', 'आज']],
];
const LANG_WORDS = [
  ['en', ['english', 'ஆங்கிலம்', 'ఇంగ్లీష్', 'ಇಂಗ್ಲೀಷ್', 'ഇംഗ്ലീഷ്', 'अंग्रेज़ी', 'अंग्रेजी']], ['ta', ['tamil', 'தமிழ்']],
  ['te', ['telugu', 'తెలుగు']], ['kn', ['kannada', 'ಕನ್ನಡ']], ['ml', ['malayalam', 'മലയാളം']], ['hi', ['hindi', 'हिंदी', 'हिन्दी']],
];
/** Speciality (matched against doctors' department / specialisations) ← words a caller might use. */
export const SPECIALTY_WORDS = [
  ['cardio', ['heart', 'cardio', 'chest', 'bp', 'blood pressure', 'இதய', 'நெஞ்சு', 'గుండె', 'ఛాతీ', 'ಹೃದಯ', 'ಎದೆ', 'ഹൃദയ', 'നെഞ്ച്', 'दिल', 'हृदय', 'सीने']],
  ['ortho', ['bone', 'ortho', 'knee', 'joint', 'back pain', 'fracture', 'எலும்பு', 'மூட்டு', 'முதுகு', 'ఎముక', 'మోకాలు', 'మోకాలి', 'నడుము', 'ಮೂಳೆ', 'ಮೊಣಕಾಲು', 'ಬೆನ್ನು', 'അസ്ഥി', 'മുട്ട', 'നടുവേദന', 'हड्डी', 'घुटन', 'कमर']],
  ['pediatric', ['child', 'baby', 'kid', 'pediatric', 'paediatric', 'குழந்தை', 'పిల్ల', 'పాప', 'ಮಕ್ಕಳ', 'ಮಗು', 'കുട്ടി', 'കുഞ്ഞ്', 'बच्च']],
  ['gyn', ['pregnan', 'period', 'gyn', 'women', 'lady doctor', 'கர்ப்ப', 'மாதவிடாய்', 'గర్భ', 'ಗರ್ಭ', 'ഗർഭ', 'गर्भ', 'पीरियड', 'महिला']],
  ['derm', ['skin', 'rash', 'acne', 'itch', 'hair fall', 'derm', 'தோல்', 'அரிப்பு', 'చర్మ', 'దురద', 'ಚರ್ಮ', 'ತುರಿಕೆ', 'ത്വക്ക്', 'ചൊറിച്ചിൽ', 'त्वचा', 'खुजली', 'स्किन']],
  ['neuro', ['headache', 'brain', 'neuro', 'stroke', 'fits', 'migraine', 'தலைவலி', 'తలనొప్పి', 'ತಲೆನೋವು', 'തലവേദന', 'सिरदर्द', 'सिर दर्द']],
  ['ent', ['ear', 'nose', 'throat', 'ent', 'காது', 'தொண்டை', 'చెవి', 'గొంతు', 'ಕಿವಿ', 'ಗಂಟಲು', 'ചെവി', 'തൊണ്ട', 'कान', 'गला', 'गले']],
  ['dent', ['tooth', 'teeth', 'dental', 'dentist', 'பல்', 'పన్ను', 'ಹಲ್ಲು', 'പല്ല്', 'दांत', 'दाँत']],
  ['ophthal', ['eye', 'vision', 'கண்', 'కన్ను', 'కంటి', 'ಕಣ್ಣು', 'കണ്ണ്', 'आंख', 'आँख']],
  ['psych', ['stress', 'anxiety', 'depression', 'mental', 'மன அழுத்த', 'మానసిక', 'ಮಾನಸಿಕ', 'മാനസിക', 'तनाव', 'मानसिक']],
  ['diabet', ['sugar', 'diabetes', 'சர்க்கரை', 'షుగర్', 'ಸಕ್ಕರೆ', 'ഷുഗർ', 'शुगर', 'मधुमेह']],
  ['gastro', ['stomach', 'acidity', 'gastric', 'வயிறு', 'కడుపు', 'ಹೊಟ್ಟೆ', 'വയറ്', 'पेट']],
  ['general', ['fever', 'cold', 'cough', 'general', 'physician', 'body pain', 'காய்ச்சல்', 'சளி', 'இருமல்', 'జ్వరం', 'జలుబు', 'దగ్గు', 'ಜ್ವರ', 'ಶೀತ', 'ಕೆಮ್ಮು', 'പനി', 'ജലദോഷം', 'ചുമ', 'बुखार', 'सर्दी', 'खांसी', 'खाँसी']],
];

const clean = (s) => String(s ?? '').toLowerCase().replace(/[.,!?।]/g, ' ').replace(/\s+/g, ' ').trim();
const has = (text, words) => words.some((w) => text.includes(w));

/** 1-based choice from digits or a spoken number (any language), else null. */
export function choice({ digits, speech }, max) {
  const d = String(digits ?? '').trim();
  if (/^\d$/.test(d)) return Number(d) >= 1 && Number(d) <= max ? Number(d) : null;
  const t = clean(speech);
  const words = t.split(' ');
  for (let i = 0; i < Math.min(max, NUMBERS.length); i++) {
    if (NUMBERS[i].some((w) => (/^[a-z0-9]+$/.test(w) ? words.includes(w) : t.includes(w)))) return i + 1;
  }
  return null;
}
export const yesNo = ({ digits, speech }) => {
  if (digits === '1') return true;
  if (digits === '2') return false;
  const t = clean(speech);
  const words = t.split(' ');
  const hit = (list) => list.some((w) => (/^[a-z]+$/.test(w) ? words.includes(w) : t.includes(w)));
  if (hit(NO)) return false; // check "no" first: e.g. "no, not okay"
  if (hit(YES)) return true;
  return null;
};
export function dayOffset(input) {
  const c = choice(input, 3);
  if (c) return c - 1;
  const t = clean(input.speech);
  for (const [off, words] of DAY_WORDS) if (has(t, words)) return off;
  return null;
}
export function language(input) {
  const c = choice(input, 6);
  if (c) return LANGS[c - 1];
  const t = clean(input.speech);
  for (const [lang, words] of LANG_WORDS) if (has(t, words)) return lang;
  return null;
}
const specOf = (d) => clean([d.department, d.specialization, ...(d.specializations ?? [])].join(' '));

/** Doctors the caller asked for: by name, by department name, or by symptom → speciality. */
export function matchDoctors(speech, doctors) {
  const t = clean(speech);
  if (!t) return [];
  const byName = doctors.filter((d) => clean(d.name).replace(/^dr /, '').split(' ').some((part) => part.length > 2 && t.split(' ').includes(part)));
  if (byName.length) return byName;
  const byDept = doctors.filter((d) => specOf(d).split(' ').some((w) => w.length > 3 && t.includes(w)));
  if (byDept.length) return byDept;
  for (const [spec, words] of SPECIALTY_WORDS) {
    if (has(t, words)) {
      const found = doctors.filter((d) => specOf(d).includes(spec));
      if (found.length) return found;
    }
  }
  return [];
}

const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const say = (lang, key, v = {}) => ({ text: fill(P[key][lang], v), lang });
const numbered = (items) => items.map((x, i) => `${i + 1}, ${x}`).join('. ');

/**
 * One conversational turn. `input` = {speech, digits} from the caller (empty on the first turn).
 * Returns {state, prompts: [{text, lang}], gather, hangup, handoff, booking}.
 * ctx: {hospital, today(): yyyy-MM-dd, addDays(ymd, n), doctors(), freeSlots(doctorId, ymd),
 *       findPatient(phone), book({doctor, date, time, patient}) → {token, appointmentId}}.
 */
export async function turn(state, input, ctx) {
  const s = { step: 'start', misses: 0, ...state };
  const lang = s.lang ?? 'en';
  const out = (prompts, extra = {}) => ({ state: s, prompts, gather: true, hangup: false, handoff: false, ...extra });
  const miss = (prompts) => {
    s.misses += 1;
    if (s.misses >= 3) return { state: { ...s, step: 'done' }, prompts: [say(lang, 'sorry'), say(lang, ctx.receptionNumber ? 'handoff' : 'callback')], gather: false, hangup: !ctx.receptionNumber, handoff: Boolean(ctx.receptionNumber) };
    return out([say(lang, 'sorry'), ...prompts]);
  };
  const askDay = () => { s.step = 'day'; return out([say(lang, 'askDay', { doctor: s.doctorName })]); };
  const askSlots = async () => {
    const slots = (await ctx.freeSlots(s.doctorId, s.date)).slice(0, 4);
    if (!slots.length) { s.step = 'day'; return out([say(lang, 'noSlots'), say(lang, 'askDay', { doctor: s.doctorName })]); }
    s.slots = slots; s.step = 'slot';
    return out([say(lang, 'chooseSlot', { list: numbered(slots) })]);
  };
  const askPatient = async () => {
    const known = s.phone ? await ctx.findPatient(s.phone) : null;
    if (known) { s.known = known; s.step = 'isPatient'; return out([say(lang, 'isPatient', { name: known.name })]); }
    s.step = 'name';
    return out([say(lang, 'askName')]);
  };
  const confirm = () => { s.step = 'confirm'; return out([say(lang, 'confirm', { name: s.patient.name, doctor: s.doctorName, day: DAYS[lang][s.dayOffset], time: s.time })]); };

  switch (s.step) {
    case 'start':
      s.step = 'lang';
      return out(LANGS.map((l) => say(l, 'menu', { hospital: ctx.hospital })));
    case 'lang': {
      const l = language(input);
      if (!l) {
        s.misses += 1;
        if (s.misses < 3) return out(LANGS.map((x) => say(x, 'menu', { hospital: ctx.hospital })));
        Object.assign(s, { lang: 'en', step: 'need', misses: 0 }); // no choice after 3 tries: continue in English
        return out([say('en', 'askNeed')]);
      }
      Object.assign(s, { lang: l, step: 'need', misses: 0 });
      return out([say(l, 'askNeed')]);
    }
    case 'need': {
      const docs = matchDoctors(input.speech, await ctx.doctors());
      if (!docs.length) return miss([say(lang, 'askNeed')]);
      s.misses = 0;
      if (docs.length === 1) { Object.assign(s, { doctorId: docs[0].id, doctorName: docs[0].name }); return askDay(); }
      s.choices = docs.slice(0, 5).map((d) => ({ id: d.id, name: d.name }));
      s.step = 'doctor';
      return out([say(lang, 'chooseDoctor', { dept: docs[0].department ?? '', list: numbered(s.choices.map((d) => d.name)) })]);
    }
    case 'doctor': {
      const c = choice(input, s.choices.length);
      if (!c) return miss([say(lang, 'chooseDoctor', { dept: '', list: numbered(s.choices.map((d) => d.name)) })]);
      Object.assign(s, { doctorId: s.choices[c - 1].id, doctorName: s.choices[c - 1].name, misses: 0 });
      return askDay();
    }
    case 'day': {
      const off = dayOffset(input);
      if (off === null) return miss([say(lang, 'askDay', { doctor: s.doctorName })]);
      Object.assign(s, { dayOffset: off, date: ctx.addDays(ctx.today(), off), misses: 0 });
      return askSlots();
    }
    case 'slot': {
      const c = choice(input, s.slots.length);
      if (!c) return miss([say(lang, 'chooseSlot', { list: numbered(s.slots) })]);
      Object.assign(s, { time: s.slots[c - 1], misses: 0 });
      return s.patient ? confirm() : askPatient();
    }
    case 'isPatient': {
      const yn = yesNo(input);
      if (yn === null) return miss([say(lang, 'isPatient', { name: s.known.name })]);
      s.misses = 0;
      if (yn) { s.patient = { id: s.known.id, name: s.known.name, phone: s.phone }; return confirm(); }
      s.step = 'name';
      return out([say(lang, 'askName')]);
    }
    case 'name': {
      const name = String(input.speech ?? '').replace(/^(my name is|name is|it'?s|this is)\s+/i, '').trim();
      if (name.length < 2) return miss([say(lang, 'askName')]);
      s.patient = { id: null, name: name.replace(/\b\w/g, (ch) => ch.toUpperCase()), phone: s.phone };
      s.misses = 0;
      return confirm();
    }
    case 'confirm': {
      const yn = yesNo(input);
      if (yn === null) return miss([say(lang, 'confirm', { name: s.patient.name, doctor: s.doctorName, day: DAYS[lang][s.dayOffset], time: s.time })]);
      if (!yn) {
        Object.assign(s, { step: 'need', doctorId: null, doctorName: null, time: null, misses: 0 });
        return out([say(lang, 'restart'), say(lang, 'askNeed')]);
      }
      try {
        const booking = await ctx.book({ doctor: { id: s.doctorId, name: s.doctorName }, date: s.date, time: s.time, patient: s.patient });
        Object.assign(s, { step: 'done', booking });
        return { state: s, prompts: [say(lang, 'booked', { token: booking.token })], gather: false, hangup: true, handoff: false, booking };
      } catch (e) {
        if (e.code !== 'SLOT_TAKEN') throw e;
        const r = await askSlots();
        r.prompts.unshift(say(lang, 'taken'));
        return r;
      }
    }
    default:
      return { state: s, prompts: [], gather: false, hangup: true, handoff: false };
  }
}
