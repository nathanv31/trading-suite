import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TradeProvider } from './context/TradeContext';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import HomePage from './pages/HomePage';
import AnalyticsPage from './pages/AnalyticsPage';
import CalendarPage from './pages/CalendarPage';
import JournalPage from './pages/JournalPage';

export default function App() {
  return (
    <BrowserRouter>
      <TradeProvider>
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex-1 overflow-y-auto">
            <Header />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/journal" element={<JournalPage />} />
            </Routes>
          </div>
        </div>
      </TradeProvider>
    </BrowserRouter>
  );
}
