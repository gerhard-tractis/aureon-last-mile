import { describe, it, expect } from 'vitest'
import { applyRememberMe, REMEMBER_ME_MAX_AGE } from '@/lib/supabase/middleware'

describe('applyRememberMe', () => {
  it('adds maxAge to all cookies when rememberMe=true', () => {
    const result = applyRememberMe(
      [{ name: 'sb-access-token', value: 'tok', options: { path: '/' } }],
      true
    )
    expect(result[0].options?.maxAge).toBe(REMEMBER_ME_MAX_AGE)
  })

  it('does not add maxAge when rememberMe=false', () => {
    const result = applyRememberMe(
      [{ name: 'sb-access-token', value: 'tok', options: { path: '/' } }],
      false
    )
    expect(result[0].options?.maxAge).toBeUndefined()
  })

  it('preserves existing options when adding maxAge', () => {
    const result = applyRememberMe(
      [{ name: 'sb-access-token', value: 'tok', options: { path: '/', httpOnly: true } }],
      true
    )
    expect(result[0].options?.httpOnly).toBe(true)
    expect(result[0].options?.maxAge).toBe(REMEMBER_ME_MAX_AGE)
  })
})
