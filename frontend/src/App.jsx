import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import MapComponent from './components/MapComponent';

const SOCKET_SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function App() {
  const [user, setUser] = useState(null); // { id, username }
  const [activeTripId, setActiveTripId] = useState(null);
  const [globalSocket, setGlobalSocket] = useState(null);

  const handleLoginSuccess = (user_id, username) => {
    setUser({ id: user_id, username });
  };

  const handleJoinTrip = (tripId) => {
    setActiveTripId(tripId);
  };

  useEffect(() => {
    // Only connect socket globally once logged in to receive invites
    if (user) {
        const socket = io(SOCKET_SERVER_URL);
        
        socket.on('connect', () => {
            console.log("Global Push Socket connected.");
            socket.emit('register_socket', { username: user.username });
        });

        setGlobalSocket(socket);

        return () => {
           socket.disconnect();
           setGlobalSocket(null);
        };
    }
  }, [user]);

  // Auth Screen Flow
  if (!user) {
    return <Auth onLoginSuccess={handleLoginSuccess} />;
  }

  // Dashboard Flow (Create groups, send/receive invites)
  if (user && !activeTripId) {
    return (
        <Dashboard 
            userId={user.id} 
            username={user.username} 
            onJoinTrip={handleJoinTrip} 
            onLogout={() => setUser(null)}
            globalSocket={globalSocket} 
        />
    );
  }

  // Active Map Flow
  return (
    <MapComponent 
        userId={user.id}
        username={user.username}
        tripId={activeTripId} 
        globalSocket={globalSocket}
        onLeaveTrip={() => setActiveTripId(null)}
    />
  );
}

export default App;
