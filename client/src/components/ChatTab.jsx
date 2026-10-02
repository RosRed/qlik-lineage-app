import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Trash2, Copy, Check, MessageSquare, ChevronDown, Zap, Brain } from 'lucide-react';
import { api } from '../api';
import toast from 'react-hot-toast';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import javascript from 'highlight.js/lib/languages/javascript';
import 'highlight.js/styles/github-dark.css';

hljs.registerLanguage('sql', sql);
hljs.registerLanguage('qlik', javascript);

const MODES = [
  { value: 'lineage', label: 'Lineage' },
  { value: 'sql', label: 'SQL' },
  { value: 'qlik', label: 'Script Qlik' },
  { value: 'general', label: 'Général' }
];

const SHORTCUTS = [
  { label: 'Lineage complet', msg: 'Génère le lineage complet de cette application avec toutes les transformations.' },
  { label: 'SQL → CA mensuel', msg: 'Écris le SQL pour calculer le chiffre d\'affaires mensuel avec le chemin de lineage en commentaire.' },
  { label: 'Script Qlik FACT', msg: 'Génère le script Qlik complet pour charger la table de faits principale.' },
  { label: 'Champs calculés', msg: 'Liste tous les champs calculés avec leur formule complète et la table source.' },
  { label: 'Risques clés synth', msg: 'Identifie et explique tous les risques liés aux clés synthétiques de cette application.' }
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="p-1 text-ink-muted hover:text-ink transition-colors">
      {copied ? <Check size={12} className="text-accent-ink" /> : <Copy size={12} />}
    </button>
  );
}

function MessageContent({ content }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
          const lang = match?.[1] || 'sql';
          const code = match?.[2] || part.slice(3, -3);
          let highlighted;
          try {
            highlighted = hljs.highlight(code, { language: lang === 'qlik' ? 'javascript' : (lang || 'sql') }).value;
          } catch {
            highlighted = hljs.highlightAuto(code).value;
          }
          return (
            <div key={i} className="relative group">
              <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <CopyButton text={code} />
              </div>
              <pre className="hljs rounded-lg overflow-x-auto text-xs">
                <code dangerouslySetInnerHTML={{ __html: highlighted }} />
              </pre>
            </div>
          );
        }
        return part ? <p key={i} className="text-sm leading-relaxed whitespace-pre-wrap">{part}</p> : null;
      })}
    </div>
  );
}

export default function ChatTab({ app, analysis }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('general');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const bottomRef = useRef();

  useEffect(() => {
    if (!app) return;
    api.getChat(app.id).then(setMessages).catch(() => {});
  }, [app?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || streaming || !app) return;
    const msg = text.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, mode }]);
    setStreaming(true);
    setStreamText('');

    try {
      const response = await fetch(`/api/apps/${app.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, mode })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) { full += data.text; setStreamText(full); }
              if (data.done) {
                setMessages(prev => [...prev, { role: 'assistant', content: full, mode, source: data.source || 'claude' }]);
                setStreamText('');
                setStreaming(false);
              }
              if (data.error) {
                toast.error(data.error);
                setStreaming(false);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      toast.error('Erreur de connexion');
      setStreaming(false);
    }
  }, [app, mode, streaming]);

  const clearChat = async () => {
    if (!app) return;
    await api.deleteChat(app.id);
    setMessages([]);
    toast.success('Historique effacé');
  };

  if (!app) {
    return (
      <div className="flex items-center justify-center h-full text-ink-faint">
        <div className="text-center">
          <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sélectionnez une application pour utiliser le chat</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-line flex items-center gap-3">
        <div className="relative">
          <select
            className="appearance-none bg-raised text-xs text-ink border border-line rounded px-3 py-1.5 pr-7 outline-none focus:border-accent cursor-pointer"
            value={mode}
            onChange={e => setMode(e.target.value)}
          >
            {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
        </div>
        <div className="flex-1 flex gap-2 overflow-x-auto">
          {SHORTCUTS.map((s, i) => (
            <button
              key={i}
              onClick={() => sendMessage(s.msg)}
              disabled={streaming}
              className="shrink-0 text-xs px-2.5 py-1.5 bg-raised hover:bg-raised border border-line text-ink-muted hover:text-ink rounded transition-colors disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
        <button onClick={clearChat} className="text-ink-faint hover:text-danger transition-colors p-1">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-ink-faint py-12 text-sm">
            <MessageSquare size={32} className="mx-auto mb-3 opacity-20" />
            Posez une question sur <span className="text-accent-ink">{app.name}</span>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-accent-soft border border-accent text-ink'
                : 'bg-raised border border-line text-ink'
            }`}>
              {msg.role === 'assistant' ? (
                <>
                  <MessageContent content={msg.content} />
                  {/* Badge source */}
                  <div className="mt-2 flex justify-end">
                    {msg.source === 'local' ? (
                      <span className="flex items-center gap-1 text-[10px] text-warn opacity-70">
                        <Zap size={9} /> Local
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-violet opacity-70">
                        <Brain size={9} /> Claude
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        {streaming && streamText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] bg-raised border border-line text-ink rounded-lg px-4 py-3">
              <MessageContent content={streamText} />
              <span className="inline-block w-1.5 h-4 bg-accent animate-pulse ml-0.5 align-middle" />
            </div>
          </div>
        )}
        {streaming && !streamText && (
          <div className="flex justify-start">
            <div className="bg-raised border border-line rounded-lg px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-line">
        <div className="flex gap-2">
          <textarea
            className="flex-1 bg-raised text-sm text-ink placeholder-ink-faint border border-line focus:border-accent rounded-lg px-3 py-2.5 resize-none outline-none leading-relaxed"
            placeholder={`Posez une question sur ${app.name}...`}
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            disabled={streaming}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={streaming || !input.trim()}
            className="px-3 py-2.5 bg-accent hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-xs text-ink-faint mt-1.5">Entrée pour envoyer · Shift+Entrée pour nouvelle ligne</p>
      </div>
    </div>
  );
}
