import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import 'react-native-url-polyfill/auto'
import { Database } from './types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

export async function uploadFile(userId: string, filename: string, uri: string, mimeType?: string) {
  filename = filename.replace(/[^0-9a-zA-Z!\-_.*'()]/g, '_')
  filename = `${userId}/${filename}`
  
  const response = await fetch(uri)
  const arrayBuffer = await response.arrayBuffer()
  const fileData = new Uint8Array(arrayBuffer)
  
  return supabase.storage.from('files').upload(filename, fileData, {
    contentType: mimeType || 'application/octet-stream',
    upsert: false,
  })
}

export async function getFiles(userId: string) {
  return supabase.storage.from('files').list(userId)
}

export async function deleteFile(userId: string, filename: string) {
  filename = `${userId}/${filename}`
  return supabase.storage.from('files').remove([filename])
}

export async function shareFile(userId: string, filename: string, timeInSec: number) {
  filename = `${userId}/${filename}`
  return supabase.storage.from('files').createSignedUrl(filename, timeInSec)
}