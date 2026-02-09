import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { storage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'expo-router'
import { Globe } from 'lucide-react-native'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function LoginScreen() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showLanguageModal, setShowLanguageModal] = useState(false)

  async function handleLogin() {
    setError('')
    setLoading(true)
    
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    
    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    
    if (mfaData?.nextLevel === 'aal2' && mfaData.nextLevel !== mfaData.currentLevel) {
      router.replace('/(auth)/two-factor')
    } else {
      router.replace('/(app)')
    }
    
    setLoading(false)
  }

  async function handleChangeLanguage(lang: string) {
    await storage.setLanguage(lang)
    i18n.changeLanguage(lang)
    setShowLanguageModal(false)
  }

  const getLanguageDisplay = () => {
    switch (i18n.language) {
      case 'pl': return 'Polski'
      case 'zh': return '中文'
      default: return 'English'
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Language selector in top-right */}
      <TouchableOpacity 
        style={styles.topHint}
        onPress={() => setShowLanguageModal(true)}
      >
        <Globe size={14} color={colors.icon} />
        <Text style={[styles.hintText, { color: colors.icon }]}>
          {getLanguageDisplay()}
        </Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('auth.login')}
          </Text>
        </View>

        {error && <Alert variant="error" message={error} />}

        <Input
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.email')}
          keyboardType="email-address"
        />

        <Input
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          placeholder={t('auth.password')}
          secureTextEntry
        />

        <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
          <Text style={[styles.link, { color: colors.tint }]}>
            {t('auth.forgotPassword')}
          </Text>
        </TouchableOpacity>

        <View style={styles.buttonContainer}>
          <Button
            title={t('auth.signIn')}
            onPress={handleLogin}
            loading={loading}
          />
        </View>

        <View style={styles.footer}>
          <Text style={{ color: colors.text }}>
            {t('auth.dontHaveAccount')}{' '}
          </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
            <Text style={[styles.link, { color: colors.tint }]}>
              {t('auth.signUp')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Language Modal */}
      <Modal
        visible={showLanguageModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t('settings.language')}
            </Text>
            <TouchableOpacity onPress={() => setShowLanguageModal(false)}>
              <Text style={{ color: colors.tint }}>
                {t('settings.close')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            <TouchableOpacity
              style={[
                styles.languageOption,
                i18n.language === 'en' && { backgroundColor: colors.tint }
              ]}
              onPress={() => handleChangeLanguage('en')}
            >
              <Text style={[
                styles.languageOptionText,
                { color: i18n.language === 'en' ? '#fff' : colors.text }
              ]}>
                {t('settings.languages.english')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.languageOption,
                i18n.language === 'pl' && { backgroundColor: colors.tint }
              ]}
              onPress={() => handleChangeLanguage('pl')}
            >
              <Text style={[
                styles.languageOptionText,
                { color: i18n.language === 'pl' ? '#fff' : colors.text }
              ]}>
                {t('settings.languages.polish')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.languageOption,
                i18n.language === 'zh' && { backgroundColor: colors.tint }
              ]}
              onPress={() => handleChangeLanguage('zh')}
            >
              <Text style={[
                styles.languageOptionText,
                { color: i18n.language === 'zh' ? '#fff' : colors.text }
              ]}>
                {t('settings.languages.chinese')}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topHint: {
    position: 'absolute',
    top: 60,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 10,
  },
  hintText: {
    fontSize: 12,
    fontWeight: '500',
  },
  content: {
    padding: 24,
    paddingTop: 40,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  link: {
    fontSize: 14,
    fontWeight: '600',
  },
  buttonContainer: {
    marginTop: 24,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalContent: {
    padding: 16,
  },
  languageOption: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 12,
  },
  languageOptionText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
})