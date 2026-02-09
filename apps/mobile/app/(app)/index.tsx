import { Card } from '@/components/ui/card'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { supabase } from '@/lib/supabase'
import { Calendar, User } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function HomeScreen() {
  const { t } = useTranslation()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })
  }, [])

  const getDaysSinceRegistration = () => {
    if (!user?.created_at) return 0
    const today = new Date()
    const created = new Date(user.created_at)
    const diffTime = Math.abs(today.getTime() - created.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('home.welcome')}, {user?.email?.split('@')[0]}! 👋
          </Text>
        </View>

        <Card>
          <View style={styles.cardContent}>
            <Calendar size={24} color={colors.icon} />
            <Text style={[styles.cardText, { color: colors.text }]}>
              {t('home.memberFor', { days: getDaysSinceRegistration() })}
            </Text>
          </View>
        </Card>

        <Card>
          <View style={styles.cardContent}>
            <User size={24} color={colors.icon} />
            <View style={styles.userInfo}>
              <Text style={[styles.label, { color: colors.icon }]}>
                {t('home.email')}
              </Text>
              <Text style={[styles.value, { color: colors.text }]}>
                {user?.email}
              </Text>
            </View>
          </View>
        </Card>
      </ScrollView>
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
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardText: {
    fontSize: 16,
  },
  userInfo: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
    fontWeight: '500',
  },
})