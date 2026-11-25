import { readFileSync } from 'node:fs';

export const documentLanguages = Object.freeze([
  { code: 'en', label: 'English' }, { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' }, { code: 'ja', label: '日本語' }, { code: 'de', label: 'Deutsch' },
]);
export const validDocumentLanguage = value => documentLanguages.some(language => language.code === value);
let corpus;
export function localizedCorpus(language) {
  if (language === 'en') return null;
  if (!validDocumentLanguage(language)) throw new Error('Unsupported document language.');
  corpus ||= JSON.parse(readFileSync(new URL('./studio-localized.json', import.meta.url), 'utf8'));
  if (corpus.version !== 'zava-locales-2026-01' || !corpus.locales[language]) throw new Error('Localized synthetic corpus is unavailable.');
  return corpus.locales[language];
}
export const documentLanguageLabel = language => documentLanguages.find(item => item.code === language)?.label;
export const imageOnlyQuery = language => ({
  en: 'Image-only reference search', fr: 'Recherche par image uniquement', es: 'Búsqueda solo por imagen',
  ja: '画像のみの検索', de: 'Nur Bildsuche',
})[language];
export const sourceScope = language => `scope eq 'public'${language && language !== 'en' ? ` and language eq '${language}'` : ''}`;
export function localizedGraphAnswer(language, lots, models) {
  const values = [lots.join(', '), models.join(', ')];
  return ({
    fr: `Les sources relient les lots ${values[0]} aux modèles ${values[1]}. Cela ne prouve pas que d’autres lots ou modèles soient touchés.`,
    es: `Las fuentes vinculan los lotes ${values[0]} con los modelos ${values[1]}. Esto no demuestra que otros lotes o modelos estén afectados.`,
    ja: `出典はロット ${values[0]} とモデル ${values[1]} の関連を示しています。他のロットやモデルへの影響を示す証拠ではありません。`,
    de: `Die Quellen verknüpfen die Chargen ${values[0]} mit den Modellen ${values[1]}. Dies belegt nicht, dass andere Chargen oder Modelle betroffen sind.`,
  })[language];
}
