**MotoSync -- Real-Time Convoy Tracking and Fleet Navigation**

MotoSync is a real-time web application designed to help motorcycle riders and travel groups stay connected during group rides. Riders can create or join a trip room, share live GPS locations and speed information, view convoy members on an interactive map, check distances between riders, and send emergency SOS alerts to the active group.
The project was developed as part of industrial training and demonstrates real-time communication, geolocation tracking, REST API development, and in-memory caching.

**Overview**

Traditional navigation applications mainly focus on individual users and do not always provide the group-awareness features needed during a motorcycle convoy ride. MotoSync addresses this gap by providing a shared trip environment where riders can see the live positions of other members and coordinate more effectively.
Problem Statement
During group rides, riders can become separated because of traffic signals, road conditions, or different riding speeds. Conventional navigation tools may not provide live visibility of all convoy members, rider-to-rider distance information, or a dedicated group emergency alert. Frequent HTTP polling can also increase communication overhead.
MotoSync uses persistent, event-driven WebSocket communication and temporary Redis-based telemetry caching to support live convoy updates.

**Objectives**

Provide real-time location and speed sharing among convoy members.

Allow riders to create and join synchronized trip rooms.

Display rider positions on an interactive map.

Calculate distances between riders using the Haversine formula.

Provide an SOS broadcast feature for emergency notifications.

Maintain ride history and trip-management functionality.

