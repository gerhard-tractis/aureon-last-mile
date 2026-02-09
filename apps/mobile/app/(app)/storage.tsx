import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { deleteFile, getFiles, shareFile, supabase, uploadFile } from '@/lib/supabase'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { FileIcon, Share2, Trash2 } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert as RNAlert, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function StorageScreen() {
  const { t } = useTranslation()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [userId, setUserId] = useState<string>('')

  useEffect(() => {
    loadUser()
  }, [])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      setUserId(user.id)
      loadFiles(user.id)
    }
  }

  async function loadFiles(uid: string) {
    setLoading(true)
    setError('')
    
    const { data, error: fetchError } = await getFiles(uid)
    
    if (fetchError) {
      setError(fetchError.message)
    } else {
      setFiles(data || [])
    }
    
    setLoading(false)
  }

  async function handleUpload() {
    try {
        setError('')
        const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        })

        if (result.canceled) return

        setUploading(true)
        
        const file = result.assets[0]

        const { error: uploadError } = await uploadFile(
        userId, 
        file.name, 
        file.uri,
        file.mimeType
        )

        if (uploadError) throw uploadError

        await loadFiles(userId)
    } catch (err: any) {
        setError(err.message)
    } finally {
        setUploading(false)
    }
    }

  async function handleDelete(filename: string) {
    RNAlert.alert(
      t('storage.deleteTitle'),
      t('storage.deleteConfirm'),
      [
        { text: t('storage.cancel'), style: 'cancel' },
        {
          text: t('storage.delete'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteFile(userId, filename)
            if (error) {
              setError(error.message)
            } else {
              await loadFiles(userId)
            }
          },
        },
      ]
    )
  }

  async function handleShare(filename: string) {
    try {
        setError('')
        const { data, error } = await shareFile(userId, filename, 24 * 60 * 60)
        
        if (error) throw error

        await Clipboard.setStringAsync(data.signedUrl)

        await Share.share({
        message: data.signedUrl,
        title: `${t('storage.share')}: ${filename.split('/').pop()}`,
        })
    } catch (err: any) {
        if (err.message !== 'User did not share') {
        setError(err.message || t('storage.shareFailed'))
        }
    }
    }
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('storage.title')}
          </Text>
        </View>

        {error && <Alert variant="error" message={error} />}

        <Button
          title={uploading ? t('storage.uploading') : t('storage.upload')}
          onPress={handleUpload}
          loading={uploading}
        />

        <View style={styles.filesContainer}>
          {loading ? (
            <Text style={{ color: colors.text }}>{t('auth.loading')}</Text>
          ) : files.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.icon }]}>
              {t('storage.noFiles')}
            </Text>
          ) : (
            files.map((file) => (
              <Card key={file.name}>
                <View style={styles.fileRow}>
                  <View style={styles.fileInfo}>
                    <FileIcon size={24} color={colors.icon} />
                    <Text style={[styles.fileName, { color: colors.text }]}>
                      {file.name.split('/').pop()}
                    </Text>
                  </View>
                  <View style={styles.fileActions}>
                    <TouchableOpacity onPress={() => handleShare(file.name)}>
                      <Share2 size={20} color={colors.tint} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(file.name)}>
                      <Trash2 size={20} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              </Card>
            ))
          )}
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
    padding: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  filesContainer: {
    marginTop: 24,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 16,
    marginTop: 32,
  },
  fileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  fileName: {
    fontSize: 16,
    flex: 1,
  },
  fileActions: {
    flexDirection: 'row',
    gap: 16,
  },
})