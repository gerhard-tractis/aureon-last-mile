import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { storage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { CheckCircle, Globe } from 'lucide-react-native'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function RegisterScreen() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showLanguageModal, setShowLanguageModal] = useState(false)

  async function handleRegister() {
    setError('')
    
    if (!acceptedTerms) {
      setError(t('auth.mustAcceptTerms'))
      return
    }

    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'))
      return
    }
    
    setLoading(true)
    
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    })
    
    if (signUpError) {
      setError(signUpError.message)
    } else {
      router.replace('/(auth)/verify-email')
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

  const openLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url)
    } catch (error) {
      // Fallback to Linking if WebBrowser fails
      Linking.openURL(url)
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
            {t('auth.register')}
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

        <Input
          label={t('auth.confirmPassword')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder={t('auth.confirmPassword')}
          secureTextEntry
        />

        {/* Terms and Privacy Checkbox */}
        <TouchableOpacity
          style={styles.checkboxContainer}
          onPress={() => setAcceptedTerms(!acceptedTerms)}
        >
          <View style={[
            styles.checkbox,
            acceptedTerms && { backgroundColor: colors.tint, borderColor: colors.tint }
          ]}>
            {acceptedTerms && <CheckCircle size={16} color="#fff" />}
          </View>
          <Text style={[styles.termsText, { color: colors.text }]}>
            {t('auth.iAgreeToThe')}{' '}
            <Text 
              style={[styles.link, { color: colors.tint }]}
              onPress={(e) => {
                e.stopPropagation()
                openLink('https://basicsass.razikus.com/legal/terms')
              }}
            >
              {t('auth.termsOfService')}
            </Text>
            {' '}{t('auth.and')}{' '}
            <Text 
              style={[styles.link, { color: colors.tint }]}
              onPress={(e) => {
                e.stopPropagation()
                openLink('https://basicsass.razikus.com/legal/privacy')
              }}
            >
              {t('auth.privacyPolicy')}
            </Text>
          </Text>
        </TouchableOpacity>

        <View style={styles.buttonContainer}>
          <Button
            title={t('auth.signUp')}
            onPress={handleRegister}
            loading={loading}
            disabled={!acceptedTerms}
          />
        </View>

        <View style={styles.footer}>
          <Text style={{ color: colors.text }}>
            {t('auth.alreadyHaveAccount')}{' '}
          </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
            <Text style={[styles.link, { color: colors.tint }]}>
              {t('auth.signIn')}
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
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  termsText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
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