import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { supabase } from '@/lib/supabase'
import { CheckCircle, Shield, Trash2, Copy, Check } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import * as Clipboard from 'expo-clipboard'

interface MFASetupProps {
  onStatusChange?: () => void
}

export function MFASetup({ onStatusChange }: MFASetupProps) {
  const colorScheme = useColorScheme()
  const { t } = useTranslation()
  const colors = Colors[colorScheme ?? 'light']
  
  const [factors, setFactors] = useState<any[]>([])
  const [step, setStep] = useState<'list' | 'name' | 'enroll'>('list')
  const [factorId, setFactorId] = useState('')
  const [qrUri, setQrUri] = useState('')
  const [secret, setSecret] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [friendlyName, setFriendlyName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchFactors()
  }, [])

  async function fetchFactors() {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      setFactors(data.all || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  async function startEnrollment() {
    if (!friendlyName.trim()) {
      setError(t('mfa.errors.nameRequired'))
      return
    }

    setError('')
    setActionInProgress(true)

    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: friendlyName.trim()
      })

      if (error) throw error

      setFactorId(data.id)
      setQrUri(data.totp.uri)
      setSecret(data.totp.secret)
      setStep('enroll')
    } catch (err: any) {
      setError(err.message)
      setStep('name')
    } finally {
      setActionInProgress(false)
    }
  }

  async function verifyFactor() {
    setError('')
    setActionInProgress(true)

    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId })
      if (challenge.error) throw challenge.error

      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: verifyCode
      })
      if (verify.error) throw verify.error

      await fetchFactors()
      resetEnrollment()
      onStatusChange?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionInProgress(false)
    }
  }

  async function unenrollFactor(factorId: string) {
    setError('')
    setActionInProgress(true)

    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw error

      await fetchFactors()
      onStatusChange?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionInProgress(false)
    }
  }

  async function copySecret() {
    await Clipboard.setStringAsync(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function resetEnrollment() {
    setStep('list')
    setFactorId('')
    setQrUri('')
    setSecret('')
    setVerifyCode('')
    setFriendlyName('')
    setError('')
    setCopied(false)
  }

  if (loading) {
    return (
      <Card>
        <Text style={{ color: colors.text }}>{t('auth.loading')}</Text>
      </Card>
    )
  }

  return (
    <Card>
      <View style={styles.container}>
        <View style={styles.header}>
          <Shield size={24} color={colors.tint} />
          <Text style={[styles.title, { color: colors.text }]}>
            {t('settings.mfa')}
          </Text>
        </View>

        {error && <Alert variant="error" message={error} />}

        {step === 'list' && factors.length > 0 && (
          <ScrollView style={styles.factorsList}>
            {factors.map((factor) => (
              <View key={factor.id} style={styles.factorItem}>
                <View style={styles.factorInfo}>
                  {factor.status === 'verified' ? (
                    <CheckCircle size={20} color="#22c55e" />
                  ) : (
                    <Shield size={20} color={colors.icon} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.factorName, { color: colors.text }]}>
                      {factor.friendly_name || t('mfa.authenticatorApp')}
                    </Text>
                    <Text style={[styles.factorDate, { color: colors.icon }]}>
                      {t('mfa.added')} {new Date(factor.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => unenrollFactor(factor.id)}
                  disabled={actionInProgress}
                >
                  <Trash2 size={20} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {step === 'name' && (
          <View style={styles.stepContainer}>
            <Text style={[styles.description, { color: colors.text }]}>
              {t('mfa.nameDescription')}
            </Text>
            
            <Input
              label={t('mfa.deviceName')}
              value={friendlyName}
              onChangeText={setFriendlyName}
              placeholder={t('mfa.deviceNamePlaceholder')}
            />

            <View style={styles.buttonRow}>
              <Button
                title={t('mfa.cancel')}
                onPress={resetEnrollment}
                variant="outline"
                disabled={actionInProgress}
              />
              <Button
                title={t('mfa.continue')}
                onPress={startEnrollment}
                loading={actionInProgress}
                disabled={!friendlyName.trim()}
              />
            </View>
          </View>
        )}

        {step === 'enroll' && (
          <ScrollView style={styles.stepContainer}>
            <Text style={[styles.description, { color: colors.text }]}>
              {t('mfa.scanQR')}
            </Text>

            <View style={styles.qrContainer}>
              {qrUri && (
                <QRCode
                  value={qrUri}
                  size={200}
                  backgroundColor="white"
                />
              )}
            </View>

            <Text style={[styles.secretLabel, { color: colors.icon }]}>
              {t('mfa.manualEntry')}
            </Text>
            
            <Text style={[styles.secretText, { color: colors.text }]}>
              {secret}
            </Text>

            <TouchableOpacity
              onPress={copySecret}
              style={[styles.copyButton, { 
                backgroundColor: copied ? '#22c55e' : colors.tint,
                borderColor: copied ? '#22c55e' : colors.tint,
              }]}
              disabled={copied}
            >
              {copied ? (
                <>
                  <Check size={16} color="white" />
                  <Text style={styles.copyButtonText}>
                    {t('mfa.copied')}
                  </Text>
                </>
              ) : (
                <>
                  <Copy size={16} color="white" />
                  <Text style={styles.copyButtonText}>
                    {t('mfa.copyCode')}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Input
              label={t('mfa.verificationCode')}
              value={verifyCode}
              onChangeText={setVerifyCode}
              placeholder={t('mfa.verificationCodePlaceholder')}
              keyboardType="numeric"
            />

            <View style={styles.buttonRow}>
              <Button
                title={t('mfa.cancel')}
                onPress={resetEnrollment}
                variant="outline"
                disabled={actionInProgress}
              />
              <Button
                title={t('mfa.verify')}
                onPress={verifyFactor}
                loading={actionInProgress}
                disabled={verifyCode.length !== 6}
              />
            </View>
          </ScrollView>
        )}

        {step === 'list' && (
          <View style={styles.addButtonContainer}>
            <Text style={[styles.infoText, { color: colors.icon }]}>
              {factors.length === 0
                ? t('mfa.infoNoFactors')
                : t('mfa.infoWithFactors')}
            </Text>
            <Button
              title={t('mfa.addNew')}
              onPress={() => setStep('name')}
              disabled={actionInProgress}
            />
          </View>
        )}
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  factorsList: {
    maxHeight: 300,
  },
  factorItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    marginBottom: 8,
  },
  factorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  factorName: {
    fontSize: 16,
    fontWeight: '500',
  },
  factorDate: {
    fontSize: 12,
    marginTop: 2,
  },
  stepContainer: {
    gap: 16,
  },
  qrContainer: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 12,
    marginVertical: 16,
  },
  secretLabel: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  secretText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 2,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  copyButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  addButtonContainer: {
    gap: 16,
    marginTop: 8,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
})