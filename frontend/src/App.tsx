import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, Conversation } from './types'
import { sendTextMessage, sendImageMessage, checkHealth, fetchConversations, fetchConversationMessages, updateConversationName, deleteConversationApi } from './services/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { useTheme } from '@/components/theme-provider'
import {
  signUpUser,
  confirmSignUpUser,
  signInUser,
  signOutUser,
  isUserLoggedIn,
  getCurrentUserEmail
} from './services/auth'

export function App() {
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()

  // --- Authentication State ---
  const [isLoggedIn, setIsLoggedIn] = React.useState(isUserLoggedIn())
  const [authMode, setAuthMode] = React.useState<'LOGIN' | 'SIGNUP' | 'VERIFY'>('LOGIN')
  const [authEmail, setAuthEmail] = React.useState('')
  const [authPassword, setAuthPassword] = React.useState('')
  const [authCode, setAuthCode] = React.useState('')
  const [authLoading, setAuthLoading] = React.useState(false)

  // --- Configuration State ---
  const [apiBaseUrl, setApiBaseUrl] = React.useState<string>(() => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    if (!isLocalhost && import.meta.env.VITE_API_BASE_URL) {
      return import.meta.env.VITE_API_BASE_URL
    }
    return localStorage.getItem('api_base_url') || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'
  })
  const [userId, setUserId] = React.useState<string>(() => {
    return isLoggedIn ? getCurrentUserEmail() : 'admin'
  })

  // --- UI Layout State ---
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(() => {
    return typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  })
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)
  const [lightboxImage, setLightboxImage] = React.useState<string | null>(null)
  const [copiedBlockId, setCopiedBlockId] = React.useState<string | null>(null)

  // --- Chat & Conversation State ---
  const [conversations, setConversations] = React.useState<Conversation[]>(() => {
    const saved = localStorage.getItem('conversations')
    return saved ? JSON.parse(saved) : []
  })
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(() => {
    return localStorage.getItem('active_conversation_id') || null
  })
  const [messages, setMessages] = React.useState<Record<string, Message[]>>(() => {
    const saved = localStorage.getItem('messages_cache')
    return saved ? JSON.parse(saved) : {}
  })

  const [inputText, setInputText] = React.useState('')
  const [selectedImage, setSelectedImage] = React.useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  // --- API Health Status ---
  const { data: isBackendOnline, refetch: recheckBackendHealth, isFetching: isCheckingHealth } = useQuery({
    queryKey: ['backendHealth', apiBaseUrl],
    queryFn: () => checkHealth(apiBaseUrl),
    refetchInterval: 30000,
  })

  // --- Sync configs and sessions ---
  React.useEffect(() => {
    localStorage.setItem('api_base_url', apiBaseUrl)
  }, [apiBaseUrl])

  React.useEffect(() => {
    localStorage.setItem('user_id', userId)
  }, [userId])

  React.useEffect(() => {
    localStorage.setItem('conversations', JSON.stringify(conversations))
  }, [conversations])

  React.useEffect(() => {
    if (activeConversationId) {
      localStorage.setItem('active_conversation_id', activeConversationId)
    } else {
      localStorage.removeItem('active_conversation_id')
    }
  }, [activeConversationId])

  React.useEffect(() => {
    localStorage.setItem('messages_cache', JSON.stringify(messages))
  }, [messages])

  // Sync userId state dynamically with logged in user email
  React.useEffect(() => {
    if (isLoggedIn) {
      setUserId(getCurrentUserEmail())
    } else {
      setUserId('admin')
    }
  }, [isLoggedIn])

  // Fetch conversations from backend on mount or when API URL / Login State changes
  React.useEffect(() => {
    if (!apiBaseUrl) return

    let active = true
    async function loadConversations() {
      try {
        const backendConvs = await fetchConversations(apiBaseUrl)
        if (active) {
          setConversations(backendConvs)
        }
      } catch (err: any) {
        console.error("Failed to fetch conversations from backend:", err)
      }
    }
    loadConversations()
    return () => {
      active = false
    }
  }, [apiBaseUrl, isLoggedIn, userId])

  // Fetch messages for active conversation from backend when activeConversationId changes
  React.useEffect(() => {
    if (!activeConversationId || !apiBaseUrl) return

    const convId = activeConversationId
    const currentMessages = messages[convId] || []
    if (currentMessages.length === 0) {
      const conv = conversations.find(c => c.id === convId)
      if (conv && conv.name === 'New Chat...') {
        return
      }
    }

    let active = true
    async function loadMessages() {
      try {
        const backendMessages = await fetchConversationMessages(convId, apiBaseUrl)
        if (active) {
          setMessages((prev) => ({
            ...prev,
            [convId]: backendMessages,
          }))
        }
      } catch (err: any) {
        console.error(`Failed to fetch messages for conversation ${convId}:`, err)
      }
    }
    loadMessages()
    return () => {
      active = false
    }
  }, [activeConversationId, apiBaseUrl])

  // Scroll to bottom on new messages
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeConversationId])

  // --- Authentication Handlers ---
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authEmail.trim() || (!authPassword && authMode !== 'VERIFY')) return

    setAuthLoading(true)
    try {
      if (authMode === 'LOGIN') {
        await signInUser(authEmail.trim(), authPassword)
        setIsLoggedIn(true)
        toast({
          title: 'Welcome back!',
          description: 'Login successful.',
          type: 'success'
        })
      } else if (authMode === 'SIGNUP') {
        await signUpUser(authEmail.trim(), authPassword)
        setAuthMode('VERIFY')
        toast({
          title: 'Account Created',
          description: 'Please check your email for the verification code.',
          type: 'info'
        })
      } else if (authMode === 'VERIFY') {
        if (!authCode.trim()) {
          toast({
            title: 'Verification Code Required',
            description: 'Please enter the 6-digit confirmation code.',
            type: 'error'
          })
          setAuthLoading(false)
          return
        }
        await confirmSignUpUser(authEmail.trim(), authCode.trim())
        setAuthMode('LOGIN')
        setAuthCode('')
        setAuthPassword('')
        toast({
          title: 'Account Verified!',
          description: 'Verification successful. You can now log in.',
          type: 'success'
        })
      }
    } catch (err: any) {
      toast({
        title: 'Authentication Failed',
        description: err.message || 'Operation failed',
        type: 'error'
      })
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = () => {
    signOutUser()
    setIsLoggedIn(false)
    setActiveConversationId(null)
    toast({
      title: 'Logged Out',
      description: 'Session terminated successfully.',
      type: 'info'
    })
  }

  // --- Message mutation handlers ---
  const sendMutation = useMutation({
    mutationFn: async ({
      text,
      imageFile,
      convId
    }: {
      text: string
      imageFile: File | null
      convId: string
    }) => {
      if (imageFile) {
        return sendImageMessage(imageFile, text || null, convId, userId, apiBaseUrl)
      } else {
        return sendTextMessage(
          { message: text, conversation_id: convId, user_id: userId },
          apiBaseUrl
        )
      }
    },
    onSuccess: (data, variables) => {
      const convId = variables.convId
      const assistantMsgId = data.assistant_message_id || Math.random().toString()
      const assistantText = data.assistant_message || ''

      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: assistantText,
        created_at: data.created_at || new Date().toISOString(),
        attachment: data.attachment
      }

      setMessages((prev) => {
        const currentList = prev[convId] || []
        const updatedList = currentList.map((m) => {
          if (m.id === 'temp-user-msg') {
            return {
              ...m,
              id: data.user_message_id || m.id,
              attachment: data.attachment || m.attachment
            }
          }
          return m
        })
        return {
          ...prev,
          [convId]: [...updatedList, assistantMsg]
        }
      })

      const newName = variables.text.slice(0, 30) || 'Image Chat'
      const conv = conversations.find(c => c.id === convId)
      if (conv && conv.name === 'New Chat...') {
        updateConversationName(convId, newName, apiBaseUrl).catch((err) => {
          console.error("Failed to update conversation name on backend:", err)
        })
      }

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === convId && c.name === 'New Chat...') {
            return { ...c, name: newName }
          }
          return c
        })
      )
    },
    onError: (error: any, variables) => {
      const convId = variables.convId
      toast({
        title: 'Error sending message',
        description: error.message || 'Server is not responding',
        type: 'error'
      })

      setMessages((prev) => {
        const currentList = prev[convId] || []
        return {
          ...prev,
          [convId]: currentList.map((m) => {
            if (m.id === 'temp-user-msg') {
              return { ...m, error: error.message || 'Error occurred' }
            }
            return m
          })
        }
      })
    }
  })

  // --- Chat Handlers ---
  const handleCreateConversation = () => {
    const newId = Math.random().toString(36).substring(2, 9)
    const newConv: Conversation = {
      id: newId,
      name: 'New Chat...',
      created_at: new Date().toISOString(),
      user_id: userId
    }
    setConversations((prev) => [newConv, ...prev])
    setActiveConversationId(newId)
    setMessages((prev) => ({ ...prev, [newId]: [] }))
  }

  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()

    // Optimistic UI updates
    setConversations((prev) => prev.filter((c) => c.id !== id))
    setMessages((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
    if (activeConversationId === id) {
      setActiveConversationId(null)
    }

    // Backend deletion
    deleteConversationApi(id, apiBaseUrl).catch((err) => {
      console.error(`Failed to delete conversation ${id} from backend:`, err)
      toast({
        title: 'Delete Failed',
        description: 'Could not delete conversation from server.',
        type: 'error'
      })
    })
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5242880) {
      toast({
        title: 'File Too Large',
        description: 'Maximum image size allowed is 5 MB.',
        type: 'error'
      })
      return
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Unsupported Format',
        description: 'PNG, JPEG, and WebP formats are supported.',
        type: 'error'
      })
      return
    }

    setSelectedImage(file)
    const url = URL.createObjectURL(file)
    setImagePreviewUrl(url)
  }

  const handleRemoveImage = () => {
    setSelectedImage(null)
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl)
      setImagePreviewUrl(null)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() && !selectedImage) return

    let currentConvId = activeConversationId
    if (!currentConvId) {
      const newId = Math.random().toString(36).substring(2, 9)
      const newConv: Conversation = {
        id: newId,
        name: inputText.trim() ? inputText.trim().slice(0, 30) : 'Image Chat',
        created_at: new Date().toISOString(),
        user_id: userId
      }
      setConversations((prev) => [newConv, ...prev])
      setActiveConversationId(newId)
      setMessages((prev) => ({ ...prev, [newId]: [] }))
      currentConvId = newId
    }

    const tempUserMsg: Message = {
      id: 'temp-user-msg',
      role: 'user',
      content: inputText.trim(),
      created_at: new Date().toISOString(),
      attachment: selectedImage
        ? {
          s3_key: '',
          mime_type: selectedImage.type,
          size_bytes: selectedImage.size,
          presigned_url: imagePreviewUrl
        }
        : null
    }

    setMessages((prev) => {
      const currentList = prev[currentConvId!] || []
      return {
        ...prev,
        [currentConvId!]: [...currentList, tempUserMsg]
      }
    })

    sendMutation.mutate({
      text: inputText.trim(),
      imageFile: selectedImage,
      convId: currentConvId
    })

    setInputText('')
    handleRemoveImage()
  }

  const handleCopyCode = (codeText: string, id: string) => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopiedBlockId(id)
      setTimeout(() => setCopiedBlockId(null), 2000)
    })
  }

  // --- Beautiful React Markdown/Code Block Parser ---
  const markdownComponents = React.useMemo(() => ({
    h1: ({ children, ...props }: any) => (
      <h1 className="text-xl font-bold mt-4 mb-2 text-zinc-900 dark:text-white" {...props}>{children}</h1>
    ),
    h2: ({ children, ...props }: any) => (
      <h2 className="text-lg font-bold mt-3 mb-1.5 text-zinc-900 dark:text-white" {...props}>{children}</h2>
    ),
    h3: ({ children, ...props }: any) => (
      <h3 className="text-base font-bold mt-2.5 mb-1 text-zinc-900 dark:text-white" {...props}>{children}</h3>
    ),
    p: ({ children, ...props }: any) => (
      <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed my-2" {...props}>{children}</p>
    ),
    ul: ({ children, ...props }: any) => (
      <ul className="list-disc pl-5 my-2 space-y-1 text-zinc-700 dark:text-zinc-300" {...props}>{children}</ul>
    ),
    ol: ({ children, ...props }: any) => (
      <ol className="list-decimal pl-5 my-2 space-y-1 text-zinc-700 dark:text-zinc-300" {...props}>{children}</ol>
    ),
    li: ({ children, ...props }: any) => (
      <li className="leading-relaxed" {...props}>{children}</li>
    ),
    strong: ({ children, ...props }: any) => (
      <strong className="font-semibold text-zinc-900 dark:text-white" {...props}>{children}</strong>
    ),
    em: ({ children, ...props }: any) => (
      <em className="italic text-zinc-800 dark:text-zinc-200" {...props}>{children}</em>
    ),
    a: ({ children, href, ...props }: any) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-650 dark:text-blue-400 hover:underline font-medium" {...props}>
        {children}
      </a>
    ),
    blockquote: ({ children, ...props }: any) => (
      <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-700 pl-4 py-1 italic my-3 text-zinc-600 dark:text-zinc-400" {...props}>
        {children}
      </blockquote>
    ),
    table: ({ children, ...props }: any) => (
      <div className="overflow-x-auto my-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-left text-sm" {...props}>{children}</table>
      </div>
    ),
    thead: ({ children, ...props }: any) => (
      <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800" {...props}>{children}</thead>
    ),
    tbody: ({ children, ...props }: any) => (
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800" {...props}>{children}</tbody>
    ),
    tr: ({ children, ...props }: any) => (
      <tr className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition-colors" {...props}>{children}</tr>
    ),
    th: ({ children, ...props }: any) => (
      <th className="px-4 py-2 font-semibold text-zinc-900 dark:text-white border-r last:border-r-0 border-zinc-200 dark:border-zinc-800" {...props}>{children}</th>
    ),
    td: ({ children, ...props }: any) => (
      <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300 border-r last:border-r-0 border-zinc-200 dark:border-zinc-800" {...props}>{children}</td>
    ),
    code: ({ className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const codeText = String(children).replace(/\n$/, '')
      const isInline = !match && !codeText.includes('\n')

      const blockId = React.useId()

      if (isInline) {
        return (
          <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 font-mono text-xs text-blue-600 dark:text-blue-400" {...props}>
            {children}
          </code>
        )
      }

      const language = match ? match[1] : 'code'
      return (
        <div className="my-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 text-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-400">
            <span className="uppercase">{language}</span>
            <button
              type="button"
              onClick={() => handleCopyCode(codeText, blockId)}
              className="hover:text-zinc-200 transition-colors cursor-pointer"
            >
              {copiedBlockId === blockId ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-zinc-100">
            <code className={className} {...props}>
              {children}
            </code>
          </pre>
        </div>
      )
    }
  }), [copiedBlockId])

  const renderMarkdown = (text: string) => {
    if (!text) return null
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    )
  }

  const activeMessages = activeConversationId ? messages[activeConversationId] || [] : []

  // --- Auth Gate Modal (Clean Light UI Gate) ---
  if (!isLoggedIn) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 font-sans text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 animate-in zoom-in-95 duration-150">

          <div className="text-center space-y-1 mb-5">
            <h1 className="text-lg font-bold tracking-tight text-blue-600 dark:text-blue-500">
              Chatbot
            </h1>
            <p className="text-xs text-zinc-450">
              {authMode === 'LOGIN' && 'Sign in to access your chatbot'}
              {authMode === 'SIGNUP' && 'Create a free user account'}
              {authMode === 'VERIFY' && 'Enter the confirmation code sent to your email'}
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-zinc-500 block mb-1">EMAIL ADDRESS</label>
              <input
                type="email"
                required
                disabled={authMode === 'VERIFY' || authLoading}
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full px-3 py-2 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {authMode !== 'VERIFY' && (
              <div>
                <label className="text-[11px] font-semibold text-zinc-500 block mb-1">PASSWORD</label>
                <input
                  type="password"
                  required
                  disabled={authLoading}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}

            {authMode === 'VERIFY' && (
              <div>
                <label className="text-[11px] font-semibold text-zinc-500 block mb-1">CONFIRMATION CODE</label>
                <input
                  type="text"
                  required
                  disabled={authLoading}
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="123456"
                  maxLength={6}
                  className="w-full px-3 py-2 text-xs text-center tracking-widest font-mono rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition duration-150 disabled:opacity-50"
            >
              {authLoading ? 'Processing...' : (
                <>
                  {authMode === 'LOGIN' && 'Sign In'}
                  {authMode === 'SIGNUP' && 'Sign Up'}
                  {authMode === 'VERIFY' && 'Verify Account'}
                </>
              )}
            </button>
          </form>

          {/* Mode Switchers */}
          <div className="mt-4 pt-4 border-t border-zinc-150 dark:border-zinc-850 text-center text-xs text-zinc-500">
            {authMode === 'LOGIN' && (
              <p>
                Don't have an account?{' '}
                <button onClick={() => setAuthMode('SIGNUP')} className="text-blue-500 font-semibold hover:underline">
                  Sign Up
                </button>
              </p>
            )}
            {authMode === 'SIGNUP' && (
              <p>
                Already have an account?{' '}
                <button onClick={() => setAuthMode('LOGIN')} className="text-blue-500 font-semibold hover:underline">
                  Sign In
                </button>
              </p>
            )}
            {authMode === 'VERIFY' && (
              <p>
                Did not receive code?{' '}
                <button onClick={() => setAuthMode('LOGIN')} className="text-blue-500 font-semibold hover:underline">
                  Back to Sign In
                </button>
              </p>
            )}
          </div>

        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-50 font-sans text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">

      {/* Mobile Sidebar Overlay Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* --- LEFT SIDEBAR (Ultra-Clean, White Background) --- */}
      <aside
        className={`fixed md:relative flex flex-col border-r border-zinc-200 bg-white dark:bg-zinc-900 transition-all duration-300 z-40 shrink-0 h-full shadow-lg md:shadow-none ${isSidebarOpen
          ? 'w-64 translate-x-0'
          : 'w-64 -translate-x-full md:w-0 md:translate-x-0 overflow-hidden border-none'
          }`}
      >
        {/* Sidebar Brand Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-150 dark:border-zinc-800">
          <span className="text-lg font-bold tracking-tight text-blue-600 dark:text-blue-500">
            Chatbot
          </span>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:text-zinc-400 transition cursor-pointer block"
            aria-label="Collapse sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>

        {/* Action Button: Create Chat */}
        <div className="p-4">
          <button
            onClick={handleCreateConversation}
            className="w-full flex items-center justify-start gap-3 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-sm font-medium transition-all"
          >
            <span>+</span>
            <span>New Chat</span>
          </button>
        </div>

        {/* Navigation / History list */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1 scrollbar-thin">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-450 dark:text-zinc-550 px-2.5 py-2">
            History
          </div>

          {conversations.length === 0 ? (
            <div className="text-xs text-zinc-400 px-3 py-2 italic">
              No recent chats.
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setActiveConversationId(conv.id)}
                className={`group flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-all ${activeConversationId === conv.id
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white font-medium'
                  : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-zinc-850 dark:hover:text-zinc-200'
                  }`}
              >
                <span className="truncate text-sm">{conv.name}</span>
                <button
                  onClick={(e) => handleDeleteConversation(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 text-zinc-400 text-xs px-1"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Bottom Actions */}
        <div className="p-4 border-t border-zinc-150 dark:border-zinc-800 space-y-3 bg-zinc-50/50 dark:bg-zinc-900/50">
          {/* User Profile Card */}
          <div className="flex items-center gap-2.5 px-1 py-0.5">
            <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold select-none shadow-xs shrink-0">
              {userId.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate" title={userId}>
                {userId}
              </span>
              <span className="text-[10px] text-zinc-400 font-medium">Active Session</span>
            </div>
          </div>

          <div className="flex justify-between items-center text-xs text-zinc-550 dark:text-zinc-300 px-1 pt-1 border-t border-zinc-200/50 dark:border-zinc-800/50">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="hover:text-zinc-750 dark:hover:text-zinc-100 cursor-pointer"
            >
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
            <button
              onClick={handleLogout}
              className="text-red-500 hover:text-red-750 font-semibold cursor-pointer"
            >
              Log Out
            </button>
          </div>
        </div>
      </aside>

      {/* --- MAIN CONTENT WINDOW --- */}
      <main className="flex-1 flex flex-col relative h-full min-w-0 bg-slate-50 dark:bg-zinc-950">

        {/* Floating Sidebar Toggle (ChatGPT/Claude style) */}
        {!isSidebarOpen && (
          <button
            className="absolute top-4 left-4 p-2.5 z-20 border border-zinc-200 dark:border-zinc-850 rounded-lg bg-white/90 dark:bg-zinc-900/90 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-650 dark:text-zinc-300 backdrop-blur-xs transition-all shadow-xs hover:shadow-sm cursor-pointer block"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        )}

        {/* Chat Feed */}
        <div className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin ${!isSidebarOpen ? 'pt-16' : ''}`}>
          {activeMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center max-w-lg mx-auto text-center space-y-4 py-20">
              <h1 className="text-xl font-semibold text-zinc-850 dark:text-white">
                Serverless Chatbot Platform
              </h1>
              <p className="text-sm text-zinc-450 max-w-sm">
                Securely authenticated via AWS Cognito. Deployed on AWS Lambda.
              </p>

              <div className="flex gap-2 w-full max-w-md pt-4 justify-center">
                <button
                  onClick={() => setInputText('How does AWS Lambda work in a serverless app?')}
                  className="p-3 text-xs border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-lg shadow-xs hover:bg-zinc-50 transition text-left w-full"
                >
                  Cloud Architecture Lambda
                </button>
                <button
                  onClick={() => setInputText('Explain how an S3 bucket hosts static React applications.')}
                  className="p-3 text-xs border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-lg shadow-xs hover:bg-zinc-50 transition text-left w-full"
                >
                  SPA Hosting Guidelines
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-5">
              {activeMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="flex flex-col max-w-[85%] gap-0.5">
                    {/* Role Tag Label */}
                    <span className={`text-[10px] uppercase font-semibold tracking-wider px-2 ${msg.role === 'user' ? 'text-right text-blue-500' : 'text-left text-zinc-400'
                      }`}>
                      {msg.role === 'user' ? 'YOU' : 'ASSISTANT'}
                    </span>

                    {/* Chat Bubble */}
                    <div
                      className={`rounded-xl px-4 py-2.5 text-sm shadow-xs ${msg.role === 'user'
                        ? 'bg-blue-600 text-white font-medium'
                        : 'bg-white border border-zinc-200 text-zinc-900 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100'
                        }`}
                    >
                      {/* Presigned image attachment */}
                      {msg.attachment && (
                        <div className="mb-2 max-w-xs overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
                          <img
                            src={msg.attachment.presigned_url || ''}
                            alt="Attached file"
                            onClick={() => setLightboxImage(msg.attachment?.presigned_url || null)}
                            className="w-full max-h-40 object-cover cursor-zoom-in hover:opacity-90"
                          />
                        </div>
                      )}

                      {/* Content Render */}
                      {msg.role === 'user' ? (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      ) : (
                        <div className="prose prose-zinc dark:prose-invert max-w-none">
                          {renderMarkdown(msg.content)}
                        </div>
                      )}

                      {/* Error feedback */}
                      {msg.error && (
                        <div className="mt-1.5 text-xs text-red-300 bg-red-950/20 border border-red-500/20 px-2 py-1 rounded">
                          Failed: {msg.error}
                        </div>
                      )}
                    </div>

                    {/* Timestamp */}
                    <span className={`text-[9px] text-zinc-400 px-1 font-mono ${msg.role === 'user' ? 'text-right' : 'text-left'
                      }`}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}

              {/* Pulsing loading state */}
              {sendMutation.isPending && (
                <div className="flex justify-start">
                  <div className="flex flex-col gap-0.5 max-w-[85%]">
                    <span className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400">
                      ASSISTANT
                    </span>
                      <div className="rounded-xl px-4 py-2 border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-800 text-xs text-zinc-450 italic">
                      Thinking...
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar centered */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 z-25">
          <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex flex-col gap-2">

            {/* Attachment preview */}
            {imagePreviewUrl && (
              <div className="flex items-center gap-2 p-1.5 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-955 rounded-lg max-w-xs">
                <div className="relative h-10 w-10 rounded overflow-hidden border border-zinc-200 dark:border-zinc-850 shrink-0">
                  <img src={imagePreviewUrl} alt="Preview" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-0.5 right-0.5 h-3.5 w-3.5 bg-black/70 rounded-full flex items-center justify-center text-[8px] text-white"
                  >
                    ✕
                  </button>
                </div>
                <span className="text-xs truncate font-mono text-zinc-500">
                  {selectedImage?.name}
                </span>
              </div>
            )}

            {/* Input Row matching user image search style */}
            <div className="relative flex items-center bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-full px-4 py-1.5 focus-within:ring-2 focus-within:ring-blue-500 transition shadow-xs">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageChange}
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`text-sm mr-2.5 transition ${selectedImage ? 'text-blue-500 font-semibold' : 'text-zinc-405 hover:text-zinc-600'}`}
                title="Upload image"
              >
                📎
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask anything..."
                className="flex-1 bg-transparent border-none outline-hidden text-sm py-1.5 placeholder-zinc-450"
              />

              <button
                type="submit"
                disabled={(!inputText.trim() && !selectedImage) || sendMutation.isPending}
                className="h-8 px-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition disabled:opacity-30 shrink-0 flex items-center justify-center"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* --- LIGHTBOX MODAL --- */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <img src={lightboxImage} alt="Large Attachment" className="max-w-full max-h-[90vh] object-contain rounded" />
        </div>
      )}

      {/* --- SETTINGS DRAWER MODAL --- */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 z-45 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-sm overflow-hidden shadow-xl animate-in zoom-in-95 duration-150">

            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-850 px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50">
              <span className="font-semibold text-sm">Configuration Settings</span>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Health state */}
              <div className="flex items-center justify-between p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs">
                <span>API Heartbeat:</span>
                <span className="font-semibold flex items-center gap-1.5">
                  <span className={`inline-flex rounded-full h-2 w-2 ${isBackendOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {isBackendOnline ? 'Connected' : 'Offline'}
                </span>
                <button
                  type="button"
                  onClick={() => recheckBackendHealth()}
                  disabled={isCheckingHealth}
                  className="text-blue-500 text-[10px]"
                >
                  Recheck
                </button>
              </div>

              {/* Endpoint configuration */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-550 dark:text-zinc-400">
                  API Endpoint Base URL
                </label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="http://localhost:8080"
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* User ID display only */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-550 dark:text-zinc-400">
                  Active Cognito Email
                </label>
                <input
                  type="text"
                  disabled
                  value={userId}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 font-mono opacity-70"
                />
              </div>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-850 px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 flex justify-end">
              <Button onClick={() => setIsSettingsOpen(false)} size="sm">
                Close
              </Button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}

export default App
