import { describe, it, expect } from 'vitest'
import { applyRememberMe, REMEMBER_ME_MAX_AGE, getClearRememberMeCookie, getSetRememberMeCookie } from '@/lib/supabase/middleware'

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

describe('remember_me cookie strings', () => {
  it('getSetRememberMeCookie returns a persistent cookie string', () => {
    const s = getSetRememberMeCookie()
    expect(s).toContain('remember_me=1')
    expect(s).toContain(`max-age=${REMEMBER_ME_MAX_AGE}`)
    expect(s).toContain('SameSite=Strict')
  })

  it('getClearRememberMeCookie returns an expiring cookie string', () => {
    const s = getClearRememberMeCookie()
    expect(s).toContain('remember_me=0')
    expect(s).toContain('max-age=0')
  })
})
