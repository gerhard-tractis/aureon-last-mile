// app/(app)/intake.tsx — Pickup manifest camera intake
// Picker selects pickup point → captures photo → uploads → realtime status tracking
import { Button } from '@/components/ui/button'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { supabase } from '@/lib/supabase'
import * as ImagePicker from 'expo-image-picker'
import { Camera, CheckCircle, RefreshCw, X } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 'select_pickup_point' | 'camera' | 'preview' | 'processing' | 'success' | 'error'

interface PickupPoint {
  id: string
  name: string
  code: string
}

interface SubmissionResult {
  orders_created: number
  status: string
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function IntakeScreen() {
  const { t } = useTranslation()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']

  const [step, setStep] = useState<Step>('select_pickup_point')
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([])
  const [selectedPickupPoint, setSelectedPickupPoint] = useState<PickupPoint | null>(null)
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [result, setResult] = useState<SubmissionResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [loadingPickupPoints, setLoadingPickupPoints] = useState(false)
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Fetch pickup points ────────────────────────────────────────────────────

  const loadPickupPoints = useCallback(async () => {
    setLoadingPickupPoints(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('pickup_points')
      .select('id, name, code')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')

    if (!error) setPickupPoints((data ?? []) as PickupPoint[])
    setLoadingPickupPoints(false)
  }, [])

  useEffect(() => {
    void loadPickupPoints()
  }, [loadPickupPoints])

  // ── Camera ────────────────────────────────────────────────────────────────

  const openCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para capturar el manifiesto.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      base64: false,
    })
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri)
      setStep('preview')
    }
  }, [])

  // ── Upload & Submit ───────────────────────────────────────────────────────

  const submitManifest = useCallback(async () => {
    if (!photoUri || !selectedPickupPoint) return
    setStep('processing')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      // 1. Upload photo to Storage
      const filename = `manifests/${user.id}/${Date.now()}.jpg`
      const response = await fetch(photoUri)
      const blob = await response.blob()
      const { error: uploadError } = await supabase.storage
        .from('manifests')
        .upload(filename, blob, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw new Error(uploadError.message)

      // 2. Insert intake_submissions row
      const { data: sub, error: subError } = await supabase
        .from('intake_submissions')
        .insert({
          pickup_point_id: selectedPickupPoint.id,
          channel: 'mobile_camera',
          status: 'received',
          raw_file_url: filename,
          raw_payload: { source: 'mobile_camera', user_id: user.id },
          raw_data: { source: 'mobile_camera' },
        })
        .select('id')
        .single()
      if (subError) throw new Error(subError.message)

      const sid = (sub as { id: string }).id
      setSubmissionId(sid)

      // 3. Subscribe to realtime status updates
      subscribeToSubmission(sid)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido')
      setStep('error')
    }
  }, [photoUri, selectedPickupPoint])

  const subscribeToSubmission = useCallback((sid: string) => {
    const channel = supabase
      .channel(`intake_submission_${sid}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'intake_submissions',
          filter: `id=eq.${sid}`,
        },
        (payload) => {
          const row = payload.new as { status: string; orders_created?: number }
          if (row.status === 'parsed' || row.status === 'confirmed') {
            setResult({ orders_created: row.orders_created ?? 0, status: row.status })
            setStep('success')
            channel.unsubscribe()
          } else if (row.status === 'failed' || row.status === 'needs_review') {
            setErrorMsg(
              row.status === 'needs_review'
                ? 'El manifiesto requiere revisión manual.'
                : 'Error al procesar el manifiesto.',
            )
            setStep('error')
            channel.unsubscribe()
          }
        },
      )
      .subscribe()
    realtimeRef.current = channel
  }, [])

  useEffect(() => {
    return () => { realtimeRef.current?.unsubscribe() }
  }, [])

  const reset = useCallback(() => {
    realtimeRef.current?.unsubscribe()
    setStep('select_pickup_point')
    setPhotoUri(null)
    setSubmissionId(null)
    setResult(null)
    setErrorMsg('')
    setSelectedPickupPoint(null)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
      {step === 'select_pickup_point' && (
        <ScrollView contentContainerStyle={s.pad}>
          <Text style={[s.title, { color: colors.text }]}>Seleccionar Punto de Recogida</Text>
          <Text style={[s.sub, { color: colors.icon }]}>¿En qué cliente estás recolectando?</Text>
          {loadingPickupPoints ? (
            <ActivityIndicator color={colors.tint} style={{ marginTop: 32 }} />
          ) : (
            <FlatList
              data={pickupPoints}
              keyExtractor={(g) => g.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.genItem, { borderColor: colors.icon }]}
                  onPress={() => { setSelectedPickupPoint(item); openCamera() }}
                >
                  <Text style={[s.genName, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[s.genCode, { color: colors.icon }]}>{item.code}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </ScrollView>
      )}

      {step === 'preview' && photoUri && (
        <View style={s.fill}>
          <Image source={{ uri: photoUri }} style={s.photo} resizeMode="contain" />
          <View style={[s.previewBar, { backgroundColor: colors.background }]}>
            <TouchableOpacity style={s.cancelBtn} onPress={() => setStep('camera')}>
              <X size={22} color={colors.icon} />
              <Text style={{ color: colors.icon, marginLeft: 6 }}>Cancelar</Text>
            </TouchableOpacity>
            <Button title="Aceptar" onPress={() => { void submitManifest() }} />
          </View>
        </View>
      )}

      {step === 'processing' && (
        <View style={[s.centered, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[s.procText, { color: colors.text }]}>Procesando manifiesto...</Text>
          <Text style={[s.sub, { color: colors.icon }]}>Esto puede tomar hasta 30 segundos</Text>
        </View>
      )}

      {step === 'success' && result && (
        <View style={[s.centered, { backgroundColor: colors.background }]}>
          <CheckCircle size={64} color="#22c55e" />
          <Text style={[s.successTitle, { color: colors.text }]}>¡Manifiesto procesado!</Text>
          <Text style={[s.sub, { color: colors.icon }]}>
            {result.orders_created} pedido{result.orders_created !== 1 ? 's' : ''} creado{result.orders_created !== 1 ? 's' : ''}
          </Text>
          <View style={{ marginTop: 24 }}>
            <Button title="Procesar otro" onPress={reset} />
          </View>
        </View>
      )}

      {step === 'error' && (
        <View style={[s.centered, { backgroundColor: colors.background }]}>
          <Text style={s.errorIcon}>⚠️</Text>
          <Text style={[s.errorTitle, { color: colors.text }]}>Error al procesar</Text>
          <Text style={[s.sub, { color: colors.icon }]}>{errorMsg}</Text>
          <TouchableOpacity style={[s.retryBtn, { borderColor: colors.tint }]} onPress={reset}>
            <RefreshCw size={18} color={colors.tint} />
            <Text style={[s.retryText, { color: colors.tint }]}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'camera' && (
        <View style={[s.centered, { backgroundColor: colors.background }]}>
          <Camera size={64} color={colors.icon} />
          <Button title="Abrir cámara" onPress={() => { void openCamera() }} />
        </View>
      )}
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  pad: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  sub: { fontSize: 14, textAlign: 'center', marginTop: 8 },
  genItem: { borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 12 },
  genName: { fontSize: 16, fontWeight: '600' },
  genCode: { fontSize: 12, marginTop: 4 },
  photo: { flex: 1 },
  previewBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb',
  },
  cancelBtn: { flexDirection: 'row', alignItems: 'center' },
  procText: { fontSize: 18, fontWeight: '600', marginTop: 20 },
  successTitle: { fontSize: 22, fontWeight: '700', marginTop: 16 },
  errorIcon: { fontSize: 48 },
  errorTitle: { fontSize: 22, fontWeight: '700', marginTop: 12 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24,
    borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12 },
  retryText: { fontSize: 16, fontWeight: '600' },
})
