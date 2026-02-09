import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { StyleSheet, View, ViewStyle } from 'react-native'

interface CardProps {
  children: React.ReactNode
  style?: ViewStyle
}

export function Card({ children, style }: CardProps) {
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  
  return (
    <View style={[
      styles.card,
      { 
        backgroundColor: colors.background,
        borderColor: colorScheme === 'dark' ? '#27272a' : '#e5e7eb',
        borderWidth: 1,
      },
      style
    ]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 16,
  },
})