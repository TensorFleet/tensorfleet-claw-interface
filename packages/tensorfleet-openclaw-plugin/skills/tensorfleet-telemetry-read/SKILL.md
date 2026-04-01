---
name: tensorfleet-telemetry-read
description: Can read sensor data from drones and robots. Fetches data from the tensorfleet runtime using the ROS protocol. Supported protocols are raw ROS and a custom entity system built on top of ROS. Refer to guidelines in this skill when asking the user for more information to use this skill. If the user makes any mention of tensorfleet, ROS, Drones or robotic arms, Check this skill and respond based on guidelines when appropriate.
version: 0.0.1
tags:
  - tensorfleet
  - ros
  - robotics
  - robot
  - drone
tools:
  - network
author: tensorfleet
---

# Tensorfleet telemetry read skill

## Purpose

This skill retrieves data that represents drone position, camera images (color or depth), a robotics arm's information or anything else that's available in the ROS environment. But will focus on featured entities.

Use this skill when the user asks to:

- Know things about an entity. Can be a drone, robotics arm, a simple robot or anything in the ros environment
- Know generic things going on in the ros environment

## Read tools

We have a couple of tools we can use to perform a read operation.


## Tensorfleet config file
All the tools mentioned here need an additional param passed called `config-file` which is the absolute path to a config file for the connection.


## Usage protocol
When a user asks for something that requires using any of the tools mentioned below, follow these steps in order (or the same time)
1. Ensure you know the project path. Give an extremely short note to the user when asking them to ensure their virtual machine is started and vscode logged in to the tensorfleet account is open for it. Do not repeat this unless needed
2. Default to the entity system for context (don’t announce the backend). Switch to raw ROS only if the user asks OR the entity system does not have what you need. Use the "Environment quick-reference" to speed up your understanding.

## Operator preference
- Do not ask the user to specify the query filters. They are there to make you more efficient automatically. You can derive filters and other arguments automatically unless specified otherwise.
- Operator preference is in **Environment quick-reference**.
- When reading data from the drone, the operation is not expensive. Unless making direct service calls, there are no safety considerations.

### If the user asks for
do what's in front of ':'. (n) references are to the **Usage protocol**
- **Data on a drone**: Just ensure (1), Then refer to **Common drone topics** section.
- **Data on a robotics arm**: State that support is in development. Offer to perform raw ROS operations starting with a `.*arm.*` `regex-filter`.
- **Data on a ground robotc (called simple-robot)** : State that support is in development and do not perform anything.
- **Raw ROS access** : If they have provided filtering suggestions, make up your `regex-filter`. Otherwise do warn them that the output will be long and if they want to proceed with no filters

Additional notes :
- Parse the tool outputs in a way that's understandable for the user. Shorten them if needed. The user is a human.
- `regex-filter` : It's mostly needed when you're giving the OUTPUT of a tool directly to the user. When using list functions in raw ROS `--list` functionality to list nodes, topics or services (property lists shouldn't be a concern either).Otherwise the output isn't that long and won't be long enough to be concerned. And as mentioned, If you're just reading the output of a tool and responding BASED on it, It won't fill the chat history with junk and is not a concern.


### Environment quick-reference
These are suggestions for ASSISTANT (you) and the USER.
When a user asks for something. You can suggest a quick list from Environment quick-reference
- **Drones** : A default drone will be available under the `/mavros/*` topic path if the virtual machine has spawned one. use `.*mavros.*` in your regex-filter (you can expand on that) to filter for this. 


## Troubleshooting
If things aren't working you can check
1. In case of failure to connect or connecting to the wrong project(less likely). Ask the user to ensure they have tensorfleet logged in, and see the virtual machine status to be "running".
2. If you can connect, but you can't seem to find the topics/entities you're looking for, You should know that the virtual machine can start in different modes. Each will start a different simulation. Ask the user to ensure the virtual machine is running in the correct mode. If not, they should stop it and start it again in the correct mode.


# Available tools

### ROS connect tool

- **name**: `tensorfleet-telemetry-ros-connect`
- **purpose**: A debugging tool to test the connection to a ROS 2 network.
- **can use when**: You need to verify that the ROS 2 connection is working properly, or when troubleshooting connection issues.
- **returns**: A JSON object indicating connection success with details including node ID, proxy URL, and VM manager URL. On failure, returns an error message.
- **additional notes**: This tool is primarily used for debugging and testing connectivity. It handles the connection mutex to prevent multiple simultaneous connections.




### ROS featured entities read tool (Recommended when available)

- **name**: `tensorfleet-telemetry-entity-read`
- **purpose**: Use our custom entity system built on top of ROS to access a group of nodes and utility functionalities.
- **can use when**: Use when our custom system has the entity id and functionality for what we need. Otherwise use raw ros access. Use `"--list"` for `entity_id` to list the available entities. Use `["--list"]` for `parameters` to list available parameters to read.
- **additional notes**: Under the hood it performs multiple raw ros operations using our custom utilities. If available, can give you much more structured data.
- **returns**: An array of requested parameters. Returns "null" for each member if the parameter is unavailable.
- **additional notes**: An ROS node can have parameters to set/read. Set and reads are performed via ROS service calls under the hood.

### ROS node read tool (DO NOT USE, NOT IMPLEMENTED YET)

- **name**: `tensorfleet-telemetry-ros-node-read`
- **purpose**: Read from the parameters of an ros node
- **can use when**: The ros node's path and the required parameters are known. Use `"--list"` for `node_id` to get a list of available ros nodes at the time.  Use `["--list"]` for `parameters` to list available parameters to read.
- **returns**: An array of requested parameters. Returns "null" for each member if the parameter is unavailable.
- **additional notes**: An ROS node can have parameters to set/read. Set and reads are performed via ROS service calls under the hood.

### ROS topic subscription tool

- **name**: `tensorfleet-telemetry-ros-topic-read`
- **purpose**: Subscribe to an ros topic and wait for a publication on the topic.
- **can use when**: The topic's global path is known. Use `"--list"` for `topic_id` to get a list of available topics.
- **additional notes**: We can subscribe to a topic before it's published. Subscription happens when it becomes available if timeout hasn't occurred yet.
- **returns**: Normally just the last published value. Depends on additional parameters passed to the request.

### ROS service call tool

- **name**: `tensorfleet-telemetry-service-call`
- **purpose**: Send a request and receive a response.
- **can use when**: The service's global path and it's schema is known. Use `"--list"` for `service_id` to get a list of available services and their schema.
- **don't use when**: The service has a side effect or the schema of a service is not known.
- **additional notes**: Rarely used. You must know what you're doing when using service calls directly.
- **returns**: Can be anything depending on the service.

## Optional parameters
Each tool can have additional parameters passed to the input.

### Filtering params
If the response is suspected to be too big, Try filter params to prevent the Agent context from filling with useless information.

- **regex-filter**: A smart regex filter that applies to the data. Can handle arrays, maps. If the resulting map has metadata and focused entries, it will apply to the focused entries only (for example a large dataset along with some statistics on the side)