import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../supabase/client'
import './AuthPage.css'

type AuthPageProps = {
  user: User | null
}

const AuthPage = ({ user }: AuthPageProps) => {
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!supabase) {
      return
    }
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return
      }
      if (data.session?.user) {
        navigate('/')
      }
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        navigate('/')
      }
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [navigate])

  const handleSendOtp = useCallback(async () => {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('请输入邮箱地址。')
      return
    }
    if (!supabase) {
      setError('尚未配置 Supabase 环境变量。')
      return
    }
    setSending(true)
    setError(null)
    setStatus(null)
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: trimmed,
    })
    setSending(false)
    if (signInError) {
      setError('验证码发送失败，请稍后再试。')
      return
    }
    setStatus('验证码已发送，请查收邮箱。')
  }, [email])

  const handleVerifyOtp = useCallback(async () => {
    const trimmedEmail = email.trim()
    const trimmedOtp = otp.trim()
    if (!trimmedEmail) {
      setError('请输入邮箱地址。')
      return
    }
    if (!trimmedOtp) {
      setError('请输入验证码。')
      return
    }
    if (!supabase) {
      setError('尚未配置 Supabase 环境变量。')
      return
    }
    setVerifying(true)
    setError(null)
    setStatus(null)
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedOtp,
      type: 'email',
    })
    setVerifying(false)
    if (verifyError) {
      setError('验证码无效或已过期。')
      return
    }
    setStatus('登录成功，欢迎回来。')
  }, [email, otp])

  const handleLogout = useCallback(async () => {
    if (!supabase) {
      setError('尚未配置 Supabase 环境变量。')
      return
    }
    setError(null)
    setStatus(null)
    await supabase.auth.signOut()
  }, [])

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="hamster-logo" aria-hidden="true">
          🐹🎀
        </div>
        <h1 className="ui-title">Welcome to Hamster Nest 🐹🏰</h1>
        <p className="subtitle">Enter your password to unlock your secret lair 🤫🔑</p>
        <label className="field">
          <span className="field-label">邮箱地址</span>
          <div className="input-shell">
            <span className="input-icon" aria-hidden="true">
              👤
            </span>
            <input
              type="email"
              placeholder="输入你的邮箱"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        </label>
        <button
          type="button"
          className="primary"
          onClick={handleSendOtp}
          disabled={sending}
        >
          {sending ? '发送中...' : 'Go! 🐹💨 发送验证码'}
        </button>
        <label className="field">
          <span className="field-label">验证码</span>
          <div className="input-shell">
            <span className="input-icon" aria-hidden="true">
              🔒
            </span>
            <input
              type="text"
              placeholder="输入邮箱中的验证码"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
          </div>
        </label>
        <button
          type="button"
          className="primary"
          onClick={handleVerifyOtp}
          disabled={verifying}
        >
          {verifying ? '验证中...' : 'Go! 🐹💨 验证并登录'}
        </button>
        <button type="button" className="forgot-link" onClick={handleSendOtp}>
          Forgot Password?
        </button>
        {status ? <p className="status">{status}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="divider" />
        {user ? (
          <div className="auth-user">
            <p>
              当前用户：<strong>{user.email ?? '未知邮箱'}</strong>
            </p>
            <div className="user-actions">
              <button type="button" className="ghost" onClick={() => navigate('/')}>
                进入聊天
              </button>
              <button type="button" className="danger" onClick={handleLogout}>
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <p className="hint">登录后将自动同步你的会话与消息。</p>
        )}
      </div>
    </div>
  )
}

export default AuthPage
