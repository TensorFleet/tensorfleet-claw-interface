---
name: tensorfleet-telemetry-read
description: Can read sensor data from drones and robots. Fetches data from the tensorfleet runtime using the ROS protocol. Supported protocols are raw ROS and a custom entity system built on top of ROS
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
All the tools mentioned here need an additional param passed called `tensorfleet-project-path` which is the absolute path to a tensorfleet project. The project will require a vscode instance running with the tensorfleet account logged in and the VM started. So it can configure the connection with the VM. So the user must provide the proper path and ensure the requirements are met.

### ROS connection test tool
- **name**: `tensorfleet-telemetry-ros-connect`
- **When to use** : Use to check connection once before using any other tools
- **Purpose** : Checks the connection for the `tensorfleet-project-path`
- **returns** : A short text indicating the test result.
- **Additional notes** : This tool is internally used in other tools to establish a connection.

### ROS featured entities read tool (Recommended when available)

- **name**: `tensorfleet-telemetry-entity-read`
- **purpose**: Use our custom entity system built on top of ROS to access a group of nodes and utility functionalities.
- **can use when**: Use when our custom system has the entity id and functionality for what we need. Otherwise use raw ros access. Use `"--list"` for `entity_id` to list the available entities. Use `["--list"]` for `parameters` to list available parameters (in the `entity_params` section) to read along with the entire metadata of the requested entity.
- **additional notes**: Under the hood it performs multiple raw ros operations using our custom utilities. If available, can give you much more structured data.
- **returns**: An array of requested parameters. Returns "null" for each member if the parameter is unavailable.
- **additional notes**: An ROS node can have parameters to set/read. Set and reads are performed via ROS service calls under the hood.

### ROS node read tool

- **name**: `tensorfleet-telemetry-ros-node-read`
- **purpose**: Read from the parameters of an ros node
- **can use when**: The ros node's path and the required parameters are known. Use `"--list"` for `node_id` to get a list of available ros nodes at the time.  Use `["--list"]` for `parameters` to list available parameters to read.
- **returns**: An array of requested parameters. Returns "null" for each member if the parameter is unavailable. If `--list` is used, it will return an object with an internal `node_type_map` field that maps node paths to node types. for now, only node path matters.
- **additional notes**: An ROS node can have parameters to set/read. Set and reads are performed via ROS service calls under the hood.

### ROS topic subscription tool

- **name**: `tensorfleet-telemetry-ros-topic-read`
- **purpose**: Subscribe to an ros topic and wait for a publication on the topic.
- **can use when**: The topic's global path is known. Use `"--list"` for `topic_id` to get a list of available topics.
- **additional notes**: We can subscribe to a topic before it's published. Subscription happens when it becomes available if timeout hasn't occurred yet. If `--list` is used, it will return an object with an internal `topic_type_map` field that maps topic paths to topic types. for now, only topic path matters.
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

- **top-filter**: The most used filter that applies to the top level objects. If return type is a json object with keys. If the return type is an array of strings, it will apply to each value. If the return type is a map, it will apply to the keys. If the return type is an array of objects, It will apply to each object individually. An exception is when `--list` is used, the filter will apply to the keys and values of whatever the result focuces on.