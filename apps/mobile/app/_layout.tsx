import '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import * as Linking from 'expo-linking'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'

export default function RootLayout() {
  const router = useRouter()

  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const url = event.url
      
      if (url && url.includes('reset-password')) {
        const hashIndex = url.indexOf('#')
        if (hashIndex !== -1) {
          const hashFragment = url.substring(hashIndex + 1)
          const params = new URLSearchParams(hashFragment)
          
          const accessToken = params.get('access_token')
          const refreshToken = params.get('refresh_token')
          const type = params.get('type')
          
          
          if (accessToken && refreshToken && type === 'recovery') {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
            
            
            if (!error && data.session) {
              router.replace('/(auth)/reset-password')
            } 
          }
        }
      }
    }

    const subscription = Linking.addEventListener('url', handleDeepLink)

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url })
      }
    })

    return () => {
      subscription.remove()
    }
  }, [])

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
      <StatusBar style="auto" />
    </>
  )
}