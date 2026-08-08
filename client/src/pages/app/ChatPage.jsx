import React from 'react';
import ChatTab from '../../components/ChatTab.jsx';
import { useAppContext } from '../../layouts/AppDetailLayout.jsx';

export default function ChatPage() {
  const { app, analysis } = useAppContext();
  return (
    <div className="flex-1 min-h-0">
      <ChatTab app={app} analysis={analysis} />
    </div>
  );
}
