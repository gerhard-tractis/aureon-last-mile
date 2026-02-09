import { MFASetup } from '@/components/MFASetup'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { storage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'expo-router'
import { ChevronRight, Globe, Key, Shield, User } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Alert as RNAlert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function SettingsScreen() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  
  const [user, setUser] = useState<any>(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showMFAModal, setShowMFAModal] = useState(false)
  const [showLanguageModal, setShowLanguageModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [mfaFactors, setMfaFactors] = useState<any[]>([])

  useEffect(() => {
    loadUser()
    loadMFAFactors()
  }, [])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
  }

  async function loadMFAFactors() {
    const { data } = await supabase.auth.mfa.listFactors()
    setMfaFactors(data?.totp || [])
  }

  async function handleChangePassword() {
    setError('')
    setSuccess('')
    
    if (newPassword !== confirmPassword) {
      setError(t('settings.passwordsDoNotMatch'))
      return
    }

    if (newPassword.length < 6) {
      setError(t('settings.passwordTooShort'))
      return
    }

    setLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (updateError) {
      setError(updateError.message)
    } else {
      setSuccess(t('settings.passwordUpdated'))
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => {
        setShowPasswordModal(false)
        setSuccess('')
      }, 2000)
    }

    setLoading(false)
  }

  async function handleChangeLanguage(lang: string) {
    await storage.setLanguage(lang)
    i18n.changeLanguage(lang)
    setShowLanguageModal(false)
  }

  async function handleLogout() {
    RNAlert.alert(
      t('auth.logout'),
      t('auth.logoutConfirm'),
      [
        { text: t('storage.cancel'), style: 'cancel' },
        {
          text: t('auth.logout'),
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut()
            router.replace('/(auth)/login')
          },
        },
      ]
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('settings.title')}
          </Text>
        </View>

        {/* User Details */}
        <Card>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <User size={20} color={colors.icon} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('settings.userDetails')}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={[styles.label, { color: colors.icon }]}>
                {t('auth.email')}
              </Text>
              <Text style={[styles.value, { color: colors.text }]}>
                {user?.email}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={[styles.label, { color: colors.icon }]}>
                {t('settings.userId')}
              </Text>
              <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>
                {user?.id}
              </Text>
            </View>
          </View>
        </Card>

        {/* Change Password */}
        <TouchableOpacity onPress={() => setShowPasswordModal(true)}>
          <Card>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Key size={20} color={colors.icon} />
                <Text style={[styles.settingText, { color: colors.text }]}>
                  {t('settings.changePassword')}
                </Text>
              </View>
              <ChevronRight size={20} color={colors.icon} />
            </View>
          </Card>
        </TouchableOpacity>

        {/* MFA */}
        <TouchableOpacity onPress={() => setShowMFAModal(true)}>
          <Card>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Shield size={20} color={colors.icon} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    {t('settings.mfa')}
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.icon }]}>
                    {mfaFactors.length > 0 
                      ? `${mfaFactors.length} ${t('mfa.devicesEnrolled')}`
                      : t('settings.mfaNotEnabled')
                    }
                  </Text>
                </View>
              </View>
              <ChevronRight size={20} color={colors.icon} />
            </View>
          </Card>
        </TouchableOpacity>

        {/* Language */}
        <TouchableOpacity onPress={() => setShowLanguageModal(true)}>
          <Card>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Globe size={20} color={colors.icon} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    {t('settings.language')}
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.icon }]}>
                    {i18n.language === 'pl' 
                      ? t('settings.languages.polish')
                      : i18n.language === 'zh'
                      ? t('settings.languages.chinese')
                      : t('settings.languages.english')
                    }
                  </Text>
                </View>
              </View>
              <ChevronRight size={20} color={colors.icon} />
            </View>
          </Card>
        </TouchableOpacity>

        {/* Logout */}
        <Button
          title={t('auth.logout')}
          onPress={handleLogout}
          variant="outline"
        />
      </ScrollView>

      {/* Password Change Modal */}
      <Modal
        visible={showPasswordModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t('settings.changePassword')}
            </Text>
            <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
              <Text style={{ color: colors.tint }}>
                {t('settings.close')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            {error && <Alert variant="error" message={error} />}
            {success && <Alert variant="success" message={success} />}

            <Input
              label={t('settings.newPassword')}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder={t('settings.enterNewPassword')}
              secureTextEntry
            />

            <Input
              label={t('settings.confirmNewPassword')}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t('settings.confirmNewPasswordPlaceholder')}
              secureTextEntry
            />

            <Button
              title={t('settings.updatePassword')}
              onPress={handleChangePassword}
              loading={loading}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* MFA Modal */}
      <Modal
        visible={showMFAModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMFAModal(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t('mfa.title')}
            </Text>
            <TouchableOpacity onPress={() => {
              setShowMFAModal(false)
              loadMFAFactors()
            }}>
              <Text style={{ color: colors.tint }}>
                {t('settings.close')}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <MFASetup onStatusChange={loadMFAFactors} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

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
                styles.languageText,
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
                styles.languageText,
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
                styles.languageText,
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
  content: {
    padding: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingSubtext: {
    fontSize: 12,
    marginTop: 2,
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
  languageText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
})