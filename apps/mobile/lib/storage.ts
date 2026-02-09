import AsyncStorage from '@react-native-async-storage/async-storage'

const LANGUAGE_KEY = '@app_language'

export const storage = {
  async getLanguage(): Promise<string | null> {
    return AsyncStorage.getItem(LANGUAGE_KEY)
  },
  
  async setLanguage(lang: string): Promise<void> {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang)
  },
}