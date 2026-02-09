import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { supabase } from '@/lib/supabase'
import { Database } from '@/lib/types'
import { CheckCircle, Plus, Trash2, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Task = Database['public']['Tables']['todo_list']['Row']
type NewTask = Database['public']['Tables']['todo_list']['Insert']

export default function TasksScreen() {
  const { t } = useTranslation()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? 'light']
  
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<boolean | null>(null)
  const [userId, setUserId] = useState<string>('')
  const [modalVisible, setModalVisible] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [isUrgent, setIsUrgent] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    loadUser()
  }, [])

  useEffect(() => {
    if (userId) {
      loadTasks()
    }
  }, [filter, userId])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      setUserId(user.id)
    }
  }

  async function loadTasks() {
    setLoading(true)
    setError('')
    
    let query = supabase
      .from('todo_list')
      .select('*')
      .order('created_at', { ascending: false })

    if (filter !== null) {
      query = query.eq('done', filter)
    }

    const { data, error: fetchError } = await query
    
    if (fetchError) {
      setError(fetchError.message)
    } else {
      setTasks(data || [])
    }
    
    setLoading(false)
  }

  async function handleCreateTask() {
    if (!newTaskTitle.trim()) return

    setCreating(true)
    setError('')

    const newTask: NewTask = {
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim() || null,
      urgent: isUrgent,
      owner: userId,
      done: false,
    }

    const { error: createError } = await supabase
      .from('todo_list')
      .insert(newTask)

    if (createError) {
      setError(createError.message)
    } else {
      setModalVisible(false)
      setNewTaskTitle('')
      setNewTaskDescription('')
      setIsUrgent(false)
      await loadTasks()
    }

    setCreating(false)
  }

  async function handleMarkDone(id: number) {
    const { error } = await supabase
      .from('todo_list')
      .update({ done: true })
      .eq('id', id)

    if (error) {
      setError(error.message)
    } else {
      await loadTasks()
    }
  }

  async function handleDelete(id: number) {
    const { error } = await supabase
      .from('todo_list')
      .delete()
      .eq('id', id)

    if (error) {
      setError(error.message)
    } else {
      await loadTasks()
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('tasks.title')}
          </Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.tint }]}
            onPress={() => setModalVisible(true)}
          >
            <Plus size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {error && <Alert variant="error" message={error} />}

        <View style={styles.filterContainer}>
          <TouchableOpacity
            style={[
              styles.filterButton,
              filter === null && { backgroundColor: colors.tint },
            ]}
            onPress={() => setFilter(null)}
          >
            <Text style={[
              styles.filterText,
              filter === null ? { color: '#fff' } : { color: colors.text }
            ]}>
              {t('tasks.all')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.filterButton,
              filter === false && { backgroundColor: colors.tint },
            ]}
            onPress={() => setFilter(false)}
          >
            <Text style={[
              styles.filterText,
              filter === false ? { color: '#fff' } : { color: colors.text }
            ]}>
              {t('tasks.active')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.filterButton,
              filter === true && { backgroundColor: colors.tint },
            ]}
            onPress={() => setFilter(true)}
          >
            <Text style={[
              styles.filterText,
              filter === true ? { color: '#fff' } : { color: colors.text }
            ]}>
              {t('tasks.completed')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tasksContainer}>
          {loading ? (
            <Text style={{ color: colors.text }}>{t('auth.loading')}</Text>
          ) : tasks.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.icon }]}>
              {t('tasks.noTasks')}
            </Text>
          ) : (
            tasks.map((task) => (
              <Card key={task.id}>
                <View style={styles.taskContent}>
                  <View style={styles.taskInfo}>
                    <Text style={[
                      styles.taskTitle,
                      { color: colors.text },
                      task.done && styles.taskDone
                    ]}>
                      {task.title}
                    </Text>
                    {task.description && (
                      <Text style={[styles.taskDescription, { color: colors.icon }]}>
                        {task.description}
                      </Text>
                    )}
                    <View style={styles.taskMeta}>
                      <Text style={[styles.taskDate, { color: colors.icon }]}>
                        {new Date(task.created_at).toLocaleDateString()}
                      </Text>
                      {task.urgent && !task.done && (
                        <View style={styles.urgentBadge}>
                          <Text style={styles.urgentText}>{t('tasks.urgent')}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.taskActions}>
                    {!task.done && (
                      <TouchableOpacity onPress={() => handleMarkDone(task.id)}>
                        <CheckCircle size={24} color="#22c55e" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => handleDelete(task.id)}>
                      <Trash2 size={24} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              </Card>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t('tasks.addTask')}
            </Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <X size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
              placeholder={t('tasks.taskTitlePlaceholder')}
              placeholderTextColor={colors.icon}
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
            />

            <TextInput
              style={[styles.textArea, { color: colors.text, borderColor: colors.icon }]}
              placeholder={t('tasks.descriptionPlaceholder')}
              placeholderTextColor={colors.icon}
              value={newTaskDescription}
              onChangeText={setNewTaskDescription}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity
              style={styles.checkboxContainer}
              onPress={() => setIsUrgent(!isUrgent)}
            >
              <View style={[
                styles.checkbox,
                isUrgent && { backgroundColor: colors.tint }
              ]}>
                {isUrgent && <CheckCircle size={16} color="#fff" />}
              </View>
              <Text style={{ color: colors.text }}>{t('tasks.markAsUrgent')}</Text>
            </TouchableOpacity>

            <Button
              title={t('tasks.createTask')}
              onPress={handleCreateTask}
              loading={creating}
              disabled={!newTaskTitle.trim()}
            />
          </View>
        </SafeAreaView>
      </Modal>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  filterButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tasksContainer: {
    marginTop: 8,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 16,
    marginTop: 32,
  },
  taskContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  taskInfo: {
    flex: 1,
    gap: 4,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  taskDone: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  taskDescription: {
    fontSize: 14,
  },
  taskMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  taskDate: {
    fontSize: 12,
  },
  urgentBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  urgentText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '600',
  },
  taskActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalContent: {
    padding: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
})