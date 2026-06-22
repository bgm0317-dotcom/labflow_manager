import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Calendar, FlaskConical, AlertTriangle, Activity,
  LogOut, ChevronRight, Microscope, Menu, X,
  Chrome, ExternalLink
} from 'lucide-react';
import { getLoginToken } from '@/lib/driveUpload';
import { useAppStore, SESSION_ID } from '@/lib/store';
import { TEAM_MEMBERS } from '@/lib/types';
import type { ViewType } from '@/lib/types';
import { DashboardView } from './views/DashboardView';
import { ScheduleView } from './views/ScheduleView';
import { ReagentView } from './views/ReagentView';
import { IssuesView } from './views/IssuesView';
import { TimelineView } from './views/TimelineView';
import { IssueDetailModal } from './modals/IssueDetailModal';

const NAV_ITEMS: { id: ViewType; icon: typeof LayoutDashboard; label: string; desc: string }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', desc: '현황 요약' },
  { id: 'schedule', icon: Calendar, label: 'Schedule', desc: '주간 일정' },
  { id: 'reagent', icon: FlaskConical, label: 'Reagent', desc: '시약 관리' },
  { id: 'issues', icon: AlertTriangle, label: 'Issues', desc: '이슈 기록' },
  { id: 'timeline', icon: Activity, label: 'Timeline', desc: '공정 추적' },
];

const VIEW_TITLES: Record<ViewType, string> = {
  dashboard: 'Dashboard',
  schedule: 'Schedule',
  reagent: 'Reagent Calculator',
  issues: 'Issue Tracker',
  timeline: 'Plate Timeline',
};


function LoginScreen({ onLogin }: { onLogin: (name: string, photoUrl: string) => void }) {
  const [error, setError] = React.useState('');
  const btnRef = useRef<HTMLDivElement>(null);
  const onLoginRef = useRef(onLogin);
  useEffect(() => { onLoginRef.current = onLogin; });

  useEffect(() => {
    const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

    const init = () => {
      const g = (window as any).google;
      if (!g?.accounts?.id) return;
      g.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async (res: any) => {
          try {
            if (!res.credential) throw new Error('로그인 실패');
            // 1. Firebase에 ID token으로 로그인
            const { signInToFirebaseWithIdToken } = await import('@/lib/firebase');
            await signInToFirebaseWithIdToken(res.credential);
            // 2. ID token에서 사용자 정보 파싱 (JWT payload)
            const payload = JSON.parse(decodeURIComponent(atob(res.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
            const name: string = payload.name || payload.email || '';
            const picture: string = payload.picture || '';
            const matched = TEAM_MEMBERS.find(m => name.includes(m));
            const displayName = matched ?? name;
            // 3. Drive/Sheets용 access token 백그라운드 요청
            const { getAccessToken } = await import('@/lib/driveUpload');
            getAccessToken().catch(() => {});
            onLoginRef.current(displayName, picture);
          } catch (e: any) {
            setError(e.message || '로그인 실패');
          }
        },
        auto_select: false,
      });
      if (btnRef.current) {
        g.accounts.id.renderButton(btnRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          width: 280,
        });
      }
    };

    if ((window as any).google?.accounts?.id) {
      init();
    } else {
      const interval = setInterval(() => {
        if ((window as any).google?.accounts?.id) { clearInterval(interval); init(); }
      }, 100);
      return () => clearInterval(interval);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, hsl(222 47% 9%) 0%, hsl(217 72% 20%) 50%, hsl(222 47% 9%) 100%)' }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 -left-20 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, hsl(217 72% 52%) 0%, transparent 90%)' }} />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full opacity-8"
          style={{ background: 'radial-gradient(circle, hsl(162 55% 40%) 0%, transparent 90%)' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm relative z-10"
      >
        <div className="card-elevated p-8 space-y-8 backdrop-blur-xl" style={{ background: 'hsl(0 0% 100% / 0.95)' }}>
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, hsl(238 56% 46%) 0%, hsl(238 62% 60%) 100%)', boxShadow: '0 4px 16px hsl(238 56% 46% / 0.3)' }}
            >
              <Microscope className="w-8 h-8 text-primary-foreground" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Axiom LabFlow</h1>
              <p className="text-xs text-muted-foreground mt-1.5">macrogen.com 계정으로 로그인하세요</p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            <div ref={btnRef} />
            {error && <p className="text-xs text-destructive text-center">{error}</p>}
          </div>

          <p className="text-center text-[10px] text-muted-foreground/60 font-medium">v2.0 · {new Date().getFullYear()}</p>
        </div>
      </motion.div>
    </div>
  );
}

function SidebarNav({ view, setView, setMobileSidebarOpen }: { view: ViewType; setView: (v: ViewType) => void; setMobileSidebarOpen: (open: boolean) => void }) {
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (navRef.current) navRef.current.scrollTop = 0;
  }, [view]);
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <nav ref={navRef as any} className="flex-1 min-h-0 overflow-y-auto px-3 space-y-0.5">
      <div className="label-overline px-3 mb-2" style={{ color: 'hsl(var(--sidebar-muted))' }}>WORKSPACE</div>
      {NAV_ITEMS.map(item => {
        const isActive = view === item.id;
        return (
          <button
            key={item.id}
            onClick={() => { setView(item.id); setMobileSidebarOpen(false); }}
            className={`sidebar-item w-full ${isActive ? 'sidebar-item-active' : ''}`}
          >
            <item.icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span className="flex-1 text-left">{item.label}</span>
            {isActive && <ChevronRight className="w-3 h-3 opacity-60" />}
          </button>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const { view, setView, user, setUser, isMobileSidebarOpen, setMobileSidebarOpen, syncWithSheets, fetchKrHolidays, onlineUsers } = useAppStore();
  const mainRef = useRef<HTMLElement>(null);

  // 스크롤 리셋: 메뉴 전환 시
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [view]);

  // Sync data on mount (only after log-in)
  useEffect(() => {
    if (user) {
      syncWithSheets();
      fetchKrHolidays();
    }
  }, [user]);

  const handleLogin = useCallback((name: string, photoUrl: string) => {
    setUser({ name, emoji: '🧪', photoUrl });
  }, [setUser]);

  // Login screen
  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'hsl(220 14% 70%)' }}>
            <img src="/Axiom%20logo.png" alt="logo" className="w-6 h-6 object-contain" />
          </div>
          <span className="text-sm font-bold tracking-tight" style={{ color: 'hsl(220 14% 70%)' }}>Axiom LabFlow</span>
        </div>
      </div>

      {/* Nav */}
      <SidebarNav view={view} setView={setView} setMobileSidebarOpen={setMobileSidebarOpen} />

      {/* Tools */}
      <div className="px-3 pb-2 space-y-0.5">
        <div className="label-overline px-3 mb-2" style={{ color: 'hsl(var(--sidebar-muted))' }}>TOOLS</div>
        <a
          href="https://axiomchq.duckdns.org"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setMobileSidebarOpen(false)}
          className="sidebar-item w-full"
        >
          <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
          <span>Chip QC</span>
        </a>
      </div>

      {/* User */}
      <div className="px-3 pb-4 pt-2 border-t" style={{ borderColor: 'hsl(var(--sidebar-hover))' }}>
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0" style={{ background: 'hsl(var(--sidebar-hover))' }}>
            {user.photoUrl
              ? <img src={user.photoUrl} alt={user.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              : <span className="w-full h-full flex items-center justify-center text-lg">{user.emoji}</span>
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold truncate" style={{ color: 'hsl(var(--sidebar-fg))' }}>{user.name}</p>
          </div>
          <button onClick={() => setUser(null)} className="opacity-40 hover:opacity-100 transition-opacity" title="로그아웃">
            <LogOut className="w-3.5 h-3.5" style={{ color: 'hsl(var(--sidebar-muted))' }} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(160deg, hsl(210 60% 9%) 0%, hsl(215 50% 7%) 40%, hsl(200 55% 10%) 70%, hsl(218 48% 8%) 100%)' }}>
      {/* Desktop Sidebar */}
      <aside className="sidebar w-56 hidden md:flex flex-col shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-40 md:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -240 }} animate={{ x: 0 }} exit={{ x: -240 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="sidebar w-60 flex flex-col fixed top-0 left-0 h-screen z-50 md:hidden"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-border/60" style={{ background: 'hsl(var(--background) / 0.85)', backdropFilter: 'blur(16px) saturate(180%)' }}>
          <div className="flex items-center justify-between px-4 md:px-8 h-[56px]">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileSidebarOpen(true)} className="md:hidden p-1.5 -ml-1.5 rounded-xl hover:bg-secondary transition-colors">
                <Menu className="w-5 h-5 text-foreground" />
              </button>
              <h1 className="text-base md:text-lg font-bold text-foreground tracking-tight">{VIEW_TITLES[view]}</h1>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono hidden sm:inline text-[11px]">{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}</span>
              {/* 접속자 프로필 아이콘 (자신 포함 모두) */}
              <div className="flex items-center -space-x-1.5">
                {onlineUsers.map(u => (
                  <div key={u.sessionId} title={u.name} className="w-7 h-7 rounded-full ring-2 ring-background overflow-hidden shrink-0 bg-secondary" style={{ zIndex: 1 }}>
                    {u.photoUrl
                      ? <img src={u.photoUrl} alt={u.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      : <span className="w-full h-full flex items-center justify-center text-xs font-bold text-muted-foreground">{u.name[0]}</span>
                    }
                  </div>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main 
          ref={mainRef}
          className="flex-1 px-4 md:px-8 py-4 md:py-6 overflow-auto"
        >

          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            >
              {view === 'dashboard' && <DashboardView />}
              {view === 'schedule' && <ScheduleView />}
              {view === 'reagent' && <ReagentView />}
              {view === 'issues' && <IssuesView />}
              {view === 'timeline' && <TimelineView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <IssueDetailModal />
    </div>
  );
}
