import os
import json
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import redis

# Load env variables
load_dotenv()

from models import db, User, Group, GroupMember, GroupRequest

app = Flask(__name__)
# Enable CORS for the frontend origin
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'motosync_secret_key')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- DATABASE SETUP ---
DB_USER = os.getenv('DB_USER', 'root')
DB_PASS = os.getenv('DB_PASS', '')
DB_HOST = os.getenv('DB_HOST', '127.0.0.1')
DB_PORT = os.getenv('DB_PORT', '3306')
DB_NAME = os.getenv('DB_NAME', 'motosync')

db_url = os.getenv('SQLALCHEMY_DATABASE_URI')
if db_url:
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = f"mysql+mysqlconnector://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    try:
        db.drop_all()
        db.create_all()
        print("Database connected and tables created successfully.")
    except Exception as e:
        print(f"WARNING: Could not connect to MySQL. Ensure MySQL is running and the database '{DB_NAME}' exists.")
        print(e)

# Redis for fast location caching
REDIS_HOST = os.getenv('REDIS_HOST', '127.0.0.1')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
try:
    redis_client = redis.StrictRedis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)
    redis_client.ping()
except Exception as e:
    print("WARNING: Could not connect to Redis. Location caching won't work.")
    redis_client = None

# Track online users for notifications: { "username": "socket_id" }
user_sockets = {}

# --- AUTH ROUTES ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({"error": "Missing required fields"}), 400
        
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters"}), 400
        
    if User.query.filter_by(username=username).first():
        return jsonify({"error": "Username already exists"}), 400
        
    hashed_pw = generate_password_hash(password)
    new_user = User(username=username, password_hash=hashed_pw)
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify({"message": "User registered successfully", "user_id": new_user.id, "username": new_user.username}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    user = User.query.filter_by(username=username).first()
    
    if user and check_password_hash(user.password_hash, password):
        return jsonify({"message": "Login successful", "user_id": user.id, "username": user.username}), 200
    
    return jsonify({"error": "Invalid credentials"}), 401

@app.route('/api/users/<int:user_id>', methods=['PUT', 'DELETE'])
def manage_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    if request.method == 'DELETE':
        db.session.delete(user)
        db.session.commit()
        return jsonify({"message": "User deleted successfully"}), 200
        
    if request.method == 'PUT':
        data = request.json
        if 'username' in data and data['username']:
            ext = User.query.filter_by(username=data['username']).first()
            if ext and ext.id != user.id:
                return jsonify({"error": "Username taken"}), 400
            user.username = data['username']
        if 'password' in data and data['password']:
            if len(data['password']) < 4:
                return jsonify({"error": "Password too short"}), 400
            user.password_hash = generate_password_hash(data['password'])
            
        db.session.commit()
        return jsonify({"message": "User updated", "username": user.username}), 200

@app.route('/api/history/<int:user_id>', methods=['GET'])
def get_user_history(user_id):
    created_groups = Group.query.filter_by(creator_id=user_id, status='completed').all()
    
    memberships = GroupMember.query.filter_by(user_id=user_id).all()
    member_group_ids = [m.group_id for m in memberships]
    joined_groups = Group.query.filter(Group.id.in_(member_group_ids), Group.status=='completed').all()
    
    all_historic = {g.id: g for g in (created_groups + joined_groups)}
    
    history_list = []
    for g in all_historic.values():
        creator = User.query.get(g.creator_id)
        mems = GroupMember.query.filter_by(group_id=g.id).all()
        participant_names = []
        for m in mems:
            u = User.query.get(m.user_id)
            if u: participant_names.append(u.username)
            
        history_list.append({
            'group_id': g.id,
            'trip_id': g.trip_id,
            'creator_username': creator.username if creator else 'Unknown',
            'created_at': g.created_at.isoformat(),
            'participants': participant_names
        })
        
    history_list.sort(key=lambda x: x['created_at'], reverse=True)
    return jsonify(history_list), 200

# --- GROUP & INVITE ROUTES ---
@app.route('/api/groups', methods=['POST'])
def create_group():
    data = request.json
    trip_id = data.get('trip_id')
    creator_id = data.get('creator_id')
    
    if not trip_id or not creator_id:
        return jsonify({"error": "Missing trip_id or creator_id"}), 400
        
    existing_group = Group.query.filter_by(trip_id=trip_id).first()
    if existing_group:
        return jsonify({"error": "Group name already exists. Choose another trip_id."}), 400
        
    new_group = Group(trip_id=trip_id, creator_id=creator_id)
    db.session.add(new_group)
    db.session.commit()
    
    # Add creator to group members
    member = GroupMember(group_id=new_group.id, user_id=creator_id)
    db.session.add(member)
    db.session.commit()
    
    return jsonify({"message": "Group created", "group_id": new_group.id, "trip_id": trip_id}), 201

@app.route('/api/users/search', methods=['GET'])
def search_users():
    query = request.args.get('q', '')
    users = User.query.filter(User.username.ilike(f'%{query}%')).limit(10).all()
    return jsonify([{"id": u.id, "username": u.username} for u in users]), 200

@app.route('/api/requests', methods=['GET'])
def get_pending_requests():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([]), 400
        
    requests = GroupRequest.query.filter_by(receiver_id=user_id, status='pending').all()
    results = []
    for req in requests:
        group = Group.query.get(req.group_id)
        sender = User.query.get(req.sender_id)
        results.append({
            "request_id": req.id,
            "group_id": req.group_id,
            "trip_id": group.trip_id if group else "Unknown",
            "sender_username": sender.username if sender else "Unknown"
        })
    return jsonify(results), 200

@app.route('/api/groups/<trip_id>/info', methods=['GET'])
def get_group_info(trip_id):
    group = Group.query.filter_by(trip_id=trip_id).first()
    if not group:
        return jsonify({'error': 'Group not found'}), 404
        
    members = GroupMember.query.filter_by(group_id=group.id).all()
    creator = User.query.get(group.creator_id)
    member_list = [{'id': creator.id, 'username': creator.username, 'role': 'creator'}]
    
    for m in members:
        u = User.query.get(m.user_id)
        if u and u.id != creator.id:
            req = GroupRequest.query.filter_by(group_id=group.id, receiver_id=u.id, status='accepted').first()
            inviter_id = req.sender_id if req else None
            member_list.append({'id': u.id, 'username': u.username, 'role': 'member', 'inviter_id': inviter_id})
            
    requests = GroupRequest.query.filter_by(group_id=group.id, status='pending').all()
    req_list = []
    for r in requests:
        receiver = User.query.get(r.receiver_id)
        sender = User.query.get(r.sender_id)
        if receiver and sender:
            req_list.append({
                'request_id': r.id, 
                'sender_id': sender.id,
                'sender_username': sender.username,
                'receiver_id': receiver.id,
                'receiver_username': receiver.username
            })
            
    return jsonify({
        'group_id': group.id,
        'trip_id': group.trip_id,
        'creator_id': group.creator_id,
        'members': member_list,
        'pending_requests': req_list
    })

# --- SOCKET.IO NOTIFICATION LOGIC ---
@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")

@socketio.on('register_socket')
def handle_register_socket(data):
    """Maps a username to a socket session ID for direct notifications"""
    username = data.get('username')
    if username:
        user_sockets[username] = request.sid

@socketio.on('disconnect')
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")
    # Remove from active sockets map
    for user, sid in list(user_sockets.items()):
        if sid == request.sid:
            del user_sockets[user]

@socketio.on('send_invite')
def handle_send_invite(data):
    """Event explicitly to send a group invite from one user to another."""
    sender_id = data.get('sender_id')
    sender_username = data.get('sender_username')
    receiver_username = data.get('receiver_username')
    trip_id = data.get('trip_id')
    
    if not all([sender_id, receiver_username, trip_id]):
        return
        
    # Get Receiver model
    receiver = User.query.filter_by(username=receiver_username).first()
    group = Group.query.filter_by(trip_id=trip_id).first()
    
    if not receiver or not group:
        emit('invite_error', {'message': 'User or Group not found', 'receiver_username': receiver_username}, room=request.sid)
        return
        
    # Check if a pending invite already exists
    existing_req = GroupRequest.query.filter_by(group_id=group.id, receiver_id=receiver.id, status='pending').first()
    if existing_req:
        emit('invite_error', {'message': 'Invite already sent', 'receiver_username': receiver_username}, room=request.sid)
        return

    # Create Request in DB
    new_req = GroupRequest(group_id=group.id, sender_id=sender_id, receiver_id=receiver.id)
    db.session.add(new_req)
    db.session.commit()
    
    # If the receiver is online, push the notification
    receiver_sid = user_sockets.get(receiver_username)
    if receiver_sid:
        emit('receive_invite', {
            'request_id': new_req.id,
            'trip_id': trip_id,
            'sender_username': sender_username
        }, room=receiver_sid)
        
    emit('invite_success', {'message': f'Invite sent to {receiver_username}', 'receiver_username': receiver_username}, room=request.sid)

@socketio.on('resolve_invite')
def handle_resolve_invite(data):
    """Receiver accepts or rejects the invite."""
    request_id = data.get('request_id')
    action = data.get('action') # 'accept' or 'reject'
    user_id = data.get('user_id')
    
    req = GroupRequest.query.get(request_id)
    if not req or req.receiver_id != int(user_id):
        return
        
    sender = User.query.get(req.sender_id)
    receiver = User.query.get(req.receiver_id)

    if action == 'accept':
        req.status = 'accepted'
        # Add to GroupMembers
        member = GroupMember(group_id=req.group_id, user_id=user_id)
        db.session.add(member)
        db.session.commit()
        
        # Get trip_id so frontend can navigate/join room natively
        group = Group.query.get(req.group_id)
        if group:
            emit('invite_accepted', {'trip_id': group.trip_id}, room=request.sid)
            
        if sender and sender.username in user_sockets:
            emit('invite_response', {'receiver_username': receiver.username, 'status': 'accepted'}, room=user_sockets[sender.username])
    else:
        req.status = 'rejected'
        db.session.commit()
        emit('invite_rejected', {'request_id': request_id}, room=request.sid)
        
        if sender and sender.username in user_sockets:
            emit('invite_response', {'receiver_username': receiver.username, 'status': 'rejected'}, room=user_sockets[sender.username])

@socketio.on('cancel_invite')
def handle_cancel_invite(data):
    request_id = data.get('request_id')
    user_id = data.get('user_id')
    
    req = GroupRequest.query.get(request_id)
    if not req or req.sender_id != int(user_id):
        return
        
    receiver = User.query.get(req.receiver_id)
    
    db.session.delete(req)
    db.session.commit()
    
    emit('invite_cancelled_success', {'receiver_username': receiver.username}, room=request.sid)
    
    if receiver:
        receiver_sid = user_sockets.get(receiver.username)
        if receiver_sid:
            emit('invite_cancelled', {'request_id': request_id}, room=receiver_sid)

@socketio.on('remove_member')
def handle_remove_member(data):
    target_user_id = data.get('target_user_id')
    requester_user_id = data.get('user_id')
    trip_id = data.get('trip_id')
    
    group = Group.query.filter_by(trip_id=trip_id).first()
    if not group: return
    
    is_creator = group.creator_id == int(requester_user_id)
    req = GroupRequest.query.filter_by(group_id=group.id, receiver_id=target_user_id, sender_id=requester_user_id, status='accepted').first()
    
    if not (is_creator or req or int(target_user_id) == int(requester_user_id)):
        emit('remove_error', {'message': 'Permission denied'}, room=request.sid)
        return
        
    member = GroupMember.query.filter_by(group_id=group.id, user_id=target_user_id).first()
    if member:
        db.session.delete(member)
        db.session.commit()
        
    target_user = User.query.get(target_user_id)
    if target_user and target_user.username in user_sockets:
        target_sid = user_sockets[target_user.username]
        emit('kicked_from_trip', {'message': 'You have been removed from the group.'}, room=target_sid)
        
    emit('remove_success', {'target_user_id': target_user_id}, room=request.sid)

# --- MAP SOCKET EVENTS ---
@socketio.on('join_trip')
def handle_join_trip(data):
    """User joins a specific trip room"""
    username = data.get('user_id') # We use username on frontend mapping now
    trip_id = data.get('trip_id')
    
    if not trip_id or not username:
        emit('error', {'message': 'Missing user or trip_id'})
        return
        
    join_room(trip_id)
    print(f"User {username} joined trip room {trip_id}")
    emit('user_joined', {'user_id': username, 'message': f'User {username} joined the trip'}, room=trip_id)

@socketio.on('leave_trip')
def handle_leave_trip(data):
    username = data.get('user_id')
    trip_id = data.get('trip_id')
    leave_room(trip_id)
    emit('user_left', {'user_id': username, 'message': f'User {username} left the trip'}, room=trip_id)

@socketio.on('close_or_save_trip')
def handle_close_save_trip(data):
    action = data.get('action') # 'delete' or 'save'
    trip_id = data.get('trip_id')
    user_id = data.get('user_id')
    
    group = Group.query.filter_by(trip_id=trip_id).first()
    if not group or group.creator_id != int(user_id):
        return
        
    if action == 'delete':
        db.session.delete(group)
        db.session.commit()
    elif action == 'save':
        group.status = 'completed'
        db.session.commit()
        
    emit('trip_ended', {'message': 'The creator has officially ended this trip.'}, room=trip_id)

@socketio.on('location_update')
def handle_location_update(data):
    username = data.get('user_id')
    trip_id = data.get('trip_id')
    
    if not username or not trip_id:
        return
        
    location_data = {
        'user_id': username,
        'lat': data.get('lat'),
        'lng': data.get('lng'),
        'speed': data.get('speed', 0),
        'timestamp': data.get('timestamp')
    }
    
    if redis_client is not None:
        try:
            redis_key = f"trip:{trip_id}:user:{username}"
            redis_client.set(redis_key, json.dumps(location_data), ex=3600)
        except Exception as e:
            pass
            
    emit('friend_location_update', location_data, room=trip_id, include_self=False)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
