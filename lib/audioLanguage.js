// Do not infer Russian from Cyrillic alone (Ukrainian labels are also Cyrillic).
export function isRussianAudio(name, language = '', { originalLanguage = '' } = {}) {
  if (/субтитр|\bsubs?\b|subtitles/i.test(String(name || ''))) return false;
  const rawLang = String(language).toLowerCase().trim();
  const lang = /^(und|unknown)$/.test(rawLang) ? '' : rawLang;
  if (lang) return /^(ru|rus|russian|русский)([-_].*)?$/.test(lang);
  const label = String(name || '').toLowerCase();
  // "No translation required" describes the original speech, not its language.
  // Use the title's explicit language; a Russian title/country alone is not proof.
  if (/^(?:не требуется|перевод не требуется|без перевода|оригинал(?:ьный|ьная озвучка)?|original(?: audio)?)$/.test(label.trim())) {
    return /^(ru|rus|russian|русский)([-_].*)?$/.test(String(originalLanguage).toLowerCase().trim());
  }
  if (/грузин|армян|азербайджан|румын|венгер|чешск|словак|сербск|хорват|болгар|финск|швед|норвеж|датск|нидерланд|тайск|вьетнам|индонез|бенгал|малаялам|каннада|\b(?:georgian|armenian|romanian|hungarian|czech|slovak|serbian|croatian|bulgarian|finnish|swedish|norwegian|danish|dutch|thai|vietnamese|indonesian|bengali|malayalam|kannada)\b/.test(label)) return false;
  // Short language codes and less common foreign labels must not be accepted
  // merely because the provider also calls the track a dub/voiceover.
  if (/\b(?:en|eng|uk|ukr|ua|de|deu|ger|fr|fra|fre|es|spa|it|ita|pl|pol|ja|jpn|ko|kor|zh|zho|chi|tr|tur|pt|por|hi|hin|ar|ara|he|heb|ta|tam|te|tel)\b|україн|украин|белорус|білорус|казах|узбек|хинди|тамил|телугу|арабск|иврит|hindi|tamil|telugu|arabic|hebrew/.test(label)) return false;
  if (/укра|німець|англій|немец|француз|испан|итальян|польск|япон|корей|китай|турец|португал|\b(?:ukr|eng|english|german|deutsch|french|spanish|italian|polish|japanese|korean|chinese|turkish|portuguese|original|default)\b|англий|оригинал|субтитр|subtitles/.test(label)) return false;
  if (/\b(?:anilibria|aniliberty|anidub|anilibria\.tv|anistar|animevost|shiza|dream cast|studio band|sovetromantica)\b/.test(label)) return true;
  return /русск|\b(?:ru|rus|russian)\b|рус\.|дубл|многоголос|двухголос|одноголос|закадров|пифагор|гоблин|пучков|гланц|корол[её]ва|гаврилов|живов|визгунов|есарев|дольский|кашкин|нтв|lostfilm|tvshows|newstudio|кубик в кубе|амедиа|кравец|alexfilm|jaskier|hdrezka|red head sound/.test(label);
}

export function russianAudioTracks(tracks, names = []) {
  return tracks.map((track, index) => ({ track, index }))
    .filter(({track,index}) => isRussianAudio(names[index] || track.name, /^(und|unknown)$/i.test(track.lang || '') ? '' : track.lang));
}
