export type Locale = 'en';

export interface LocaleMeta {
  code: Locale;
  label: string;
  flag: string;
}

export const LOCALES: LocaleMeta[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

export const DEFAULT_LOCALE: Locale = 'en';

export type TranslationDict = Record<string, string>;
