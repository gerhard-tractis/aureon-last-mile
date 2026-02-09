import { AlertCircle, CheckCircle } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'

interface AlertProps {
  variant?: 'error' | 'success' | 'info'
  message: string
}

export function Alert({ variant = 'info', message }: AlertProps) {
  const colors = {
    error: { bg: '#fee2e2', text: '#991b1b', border: '#f87171' },
    success: { bg: '#dcfce7', text: '#166534', border: '#4ade80' },
    info: { bg: '#dbeafe', text: '#1e40af', border: '#60a5fa' },
  }
  
  const color = colors[variant]
  const Icon = variant === 'success' ? CheckCircle : AlertCircle
  
  return (
    <View style={[styles.alert, { backgroundColor: color.bg, borderColor: color.border }]}>
      <Icon size={20} color={color.text} />
      <Text style={[styles.text, { color: color.text }]}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  text: {
    fontSize: 14,
    flex: 1,
  },
})