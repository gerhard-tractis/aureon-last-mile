import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function TwoFactorScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [factors, setFactors] = useState<any[]>([])
  const [selectedFactorId, setSelectedFactorId] = useState('')

  useEffect(() => {
    loadFactors()
  }, [])

  async function loadFactors() {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (data) {
      const totpFactors = data.totp || []
      setFactors(totpFactors)
      if (totpFactors.length === 1) {
        setSelectedFactorId(totpFactors[0].id)
      }
    }
  }

  async function handleVerify() {
    if (!selectedFactorId) {
      setError(t('mfa.errors.noFactorSelected'))
      return
    }

    setError('')
    setLoading(true)

    try {
      const { data: challengeData, error: challengeError } = 
        await supabase.auth.mfa.challenge({ factorId: selectedFactorId })

      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: selectedFactorId,
        challengeId: challengeData.id,
        code: code,
      })

      if (verifyError) throw verifyError

      router.replace('/(app)')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('auth.twoFactorAuthentication')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>
            {t('auth.enterCode')}
          </Text>
        </View>

        {error && <Alert variant="error" message={error} />}

        <Input
          label={t('auth.verificationCode')}
          value={code}
          onChangeText={setCode}
          placeholder="000000"
          keyboardType="numeric"
        />

        <View style={styles.buttonContainer}>
          <Button
            title={t('auth.verify')}
            onPress={handleVerify}
            loading={loading}
            disabled={code.length !== 6}
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
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
  },
  buttonContainer: {
    marginTop: 24,
  },
})