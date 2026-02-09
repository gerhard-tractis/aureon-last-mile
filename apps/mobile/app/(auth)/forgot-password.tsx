import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function ForgotPasswordScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleResetPassword() {
    setError('')
    setLoading(true)
    
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'supabaseexpotemplate://reset-password',
    })
    
    if (resetError) {
      setError(resetError.message)
    } else {
      setSuccess(true)
    }
    
    setLoading(false)
  }

  if (success) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <Alert variant="success" message={t('auth.checkEmailMessage')} />
          <Button
            title={t('auth.backToLogin')}
            onPress={() => router.replace('/(auth)/login')}
          />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button
          title={t('auth.back')}
          onPress={() => router.back()}
          variant="outline"
        />
        
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('auth.resetPasswordTitle')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>
            {t('auth.resetPasswordDescription')}
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

        <View style={styles.buttonContainer}>
          <Button
            title={t('auth.sendResetLink')}
            onPress={handleResetPassword}
            loading={loading}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  header: {
    marginVertical: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
  },
  buttonContainer: {
    marginTop: 24,
  },
})