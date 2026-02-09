import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import * as Localization from 'expo-localization'
import { storage } from './storage'

import en from '../locales/en.json'
import pl from '../locales/pl.json'
import zh from '../locales/zh.json'

const deviceLanguage = Localization.locale?.split('-')[0] || 'en'

i18n.use(initReactI18next).init({
  compatibilityJSON: 'v3',
  resources: {
    en: { translation: en },
    pl: { translation: pl },
    zh: { translation: zh },
  },
  lng: deviceLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

storage.getLanguage().then((savedLanguage) => {
  if (savedLanguage) {
    i18n.changeLanguage(savedLanguage)
  }
})

export default i18n