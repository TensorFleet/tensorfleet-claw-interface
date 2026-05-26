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

# Authentication Tool
You can use the authentication tool to log into the tensorfleet account
- **name**: `tensorfleet-auth`
- **purpose**: authenticate the user's tensorfleet account
- **can use when**: User needs to log in to TensorFleet, or when other TensorFleet tools return authentication errors. This tool must be run before any other TensorFleet operations if not already authenticated.
- **parameters**:
  - `backendUrl` (optional): Custom backend URL for OAuth authentication. Defaults to https://app.tensorfleet.net/
- **returns**: JSON object with authentication status and user profile for `status`, or a pending login response with `authUrl` for `login`. After the user completes authentication in their browser, the auth token is stored globally for all subsequent tool calls. Auth token will remain in memory till openclaw gateway is restarted.
- **How it works**: When logging in, the tool returns an authentication URL. Give this link to the user and ask them to continue after they finish authentication. Do not open a browser automatically from the AI workflow.

# Virtual machine Tool
Tensorfleet robotics simulations happen in a cloud virtual machine. This tool helps managing these machines.
- **name**: `tensorfleet-vm`
- **purpose**: Select the virtual machine. that you want to use the virtual machine from. List virtual machines, stop or start your VM and.
- **WHEN TO NOT USE**: The user never specified the region. Must be 100% sure of the region the user is referring to. DO NOT USE DEFAULT ASSUMPTIONS!

# Auth + VM selection workflow
auth tool and virtual machine tool are multipurpose and give us different actions to perform.
We need to use these automatically with the workflow shown below. Please don't pause in between unless you have a question from the user.

1. User asks something. If you don't know about the auth status, run the auth status. 
   1. If not logged in, run the auth login command, give the returned `authUrl` to the user, and ask them to continue after authentication is finished. When they continue, run auth status again before proceeding.
2. Assuming auth tokens are cached, We need to know if we have selected a running virtual machine. 
   1. Check the chat history, If user has not mentioned any region, list the regions and ASK THEM which region they want to use. Even if there is only one, Ask the user!. Note that the "local" region may not list but still exists for development.
   2. Get the virtual machine status for the desired region. If it's not running, Ask for permission then start it.
      1. To start a vm you need a configuration. You have to know which configuration you're starting it. Use the `list-configs` action on `tensorfleet-vm` to get a list of possible configurations. The user must choose which to use. You can add description/notes to guide them. 
   3. Run the `select-vm` action for the `tensorfleet-vm` tool to select the running virtual machine. if the status isn't running, inform the user to wait and retry in 30 seconds. 
3. You assume auth is done, vm is selected, proceed with drone operations.


## Tensorfleet config file
If login is not done, the auth token and virtual machine id are needed. In that case they are provided via the directory path as "tensorfleet-project-path". Note that this is the legacy workflow.

# Tensorfleet telemetry read skill

## Purpose

This skill retrieves data that represents drone position, camera images (color or depth), a robotics arm's information or anything else that's available in the ROS environment. But will focus on featured entities.

Use this skill when the user asks to:

- Know things about an entity. Can be a drone, robotics arm, a simple robot or anything in the ros environment
- Know generic things going on in the ros environment

## Read tools

We have a couple of tools we can use to perform a read operation.


## Usage protocol

### Drone interfacing
When interfacing with drones first use our `tensorfleet-drone` tool unless you need lower level telemetry.
For lower level telemetry a default drone will be available under the `/mavros/*` topic path if the virtual machine has spawned one. use `.*mavros.*` in your regex-filter (you can expand on that) to filter for this.

### Other robot type interfacing
Do not do anything unless the user asks for low level telemetry. Its still in development.

### ROS access interfacing
If the user provided filtering suggestions, make up your `regex-filter`. Otherwise do warn them that the output will be long and if they want to proceed with no filters

## Generic tool guide
- DO NOT try to use any tool other than tensorfleet-auth before ensuring login status is authenticated.
- DO NOT try to use any tool other than tensorfleet-vm before ensuring vm is running, for the user-requested region. the user MUST specify the region!
- When using regex filters in tool parameters do not ask the user to specify the query filters. They are there to make you more efficient automatically. You can derive filters and other arguments automatically unless specified otherwise.
- When reading data from the drone, the operation is not expensive. Unless making direct service calls, there are no safety considerations.
- Parse the tool outputs in a way that's understandable for the user. Shorten them if needed. The user is a human.
- `regex-filter` : It's mostly needed when you're giving the OUTPUT of a tool directly to the user. When using list functions in raw ROS `--list` functionality to list nodes, topics or services (property lists shouldn't be a concern either).Otherwise the output isn't that long and won't be long enough to be concerned. And as mentioned, If you're just reading the output of a tool and responding BASED on it, It won't fill the chat history with junk and is not a concern.


## Troubleshooting
If things aren't working you can check
1. In case of failure to connect or connecting to the wrong project(less likely). Ask the user to ensure they have tensorfleet logged in, and see the virtual machine status to be "running".
2. If you can connect, but you can't seem to find the topics/entities you're looking for, You should know that the virtual machine can start in different modes. Each will start a different simulation. Ask the user to ensure the virtual machine is running in the correct mode. If not, they should stop it and start it again in the correct mode.


# Available tools
---- DO NOT TRY TO USE THESE BEFORE YOU ARE 100% SURE which region the user is refering to!!!! AND HAVE IT SELECTED! USING THE `tensorfleet-vm` REGION SELECTION! and ENSURE VM IS RUNNING!!!!!! ---

### Drone tool
- **name**: `tensorfleet-drone`
- **purpose**: get the drone state or command the drone. returns after drone reaches desired state. Which might take a while depending on the request and current state.
- **can use when**: You need to verify that the ROS 2 connection is working properly, or when troubleshooting connection issues.
- **additional notes**: For this tool we auto-detect the existing mavros drone, you don't need to specify it.

### ROS connect tool

- **name**: `tensorfleet-telemetry-ros-connect`
- **purpose**: A debugging tool to test the connection to a ROS 2 network.
- **can use when**: You need to verify that the ROS 2 connection is working properly, or when troubleshooting connection issues.
- **returns**: A JSON object indicating connection success with details including node ID, proxy URL, and VM manager URL. On failure, returns an error message.
- **additional notes**: This tool is primarily used for debugging and testing connectivity. It handles the connection mutex to prevent multiple simultaneous connections.

### ROS diagnostics tool

- **name**: `tensorfleet-ros-diagnostics`
- **purpose**: Inspect the internals of the ROS connect path, including mutex state, queue depth, active operations, reconnect timer state, recent connect attempts, config values, and current ROS bridge connectivity. Use this when ROS behavior is ambiguous and you need to distinguish a lock/resource issue from an actual connect/timeout issue.




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


