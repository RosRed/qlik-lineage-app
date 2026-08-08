// Legacy bridge — maps old method names to the new api/ layer
import { appsApi } from './api/appsApi';
import { chatApi } from './api/chatApi';

export const api = {
  getApps:     ()              => appsApi.getAll(),
  createApp:   (name)          => appsApi.create(name),
  renameApp:   (id, name)      => appsApi.rename(id, name),
  deleteApp:   (id)            => appsApi.remove(id),
  saveScript:  (id, content, filename) => appsApi.saveScript(id, content, filename),
  getScript:   (id)            => appsApi.getScript(id),
  analyze:     (id)            => appsApi.analyze(id),
  getAnalysis: (id)            => appsApi.getAnalysis(id),
  getChat:     (id)            => chatApi.getHistory(id),
  deleteChat:  (id)            => chatApi.clearHistory(id),
};
