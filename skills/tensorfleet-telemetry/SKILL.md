---
name: tensorfleet-telemetry
description: Fetches data from the tensorfleet virtual machine using the ros protocol
version: 1.0.0
---

# Tensorfleet telemtry skill

## Purpose

This skill retrieves data that represents drone position, camera images(color or depth), A robotics arm's information or anything else that's available in the ROS environment. But will focus on featured entities.

Use this skill when the user asks to:

- Know things about an entity. Can be a drone, robotics arm, a simple robot or anything in the ros environment
- Know generic things going on in the ros envrionment

# Telemetry Tool
name : tensorfleet-telemetry
inputs summary : tensorfleet-config | target-type | return-type | target-id | information-id | request-props


## tensorfleet-config
This is a path to a config file.
The ros connection configuration available in the `.tensorfleet` file. Allows us to connect to the ros environment. Connection caching is alow available for multiple requests in a short amount of time if needed.


## target-type
Supported target types are `ros-node`, `ros-topic`, `entity`, `service`
- `ros-node` : Refers to a node in the ros environment. Each node can have properties to read/write.
- `ros-topic` : Refers to an ros topic. We have to wait for a publication on the topic.
    - Usually a timeout is provided in `request-props`. Otherwise a 10 second default timeout is used.
    - `request-props` can include an `poll-and-expect` field along with the timeout. Used to avoid repeated AI agent calls when polling is needed.
- `entity` : Refers to a special type of `ros-node`. This node will contain guided information on topics and ros nodes related to it. Our tool can also provide easier to use telemetry crafted for these entities.
- `service` : Request endpoints in the ros environment. They are similar to http requests. Provide response to requests. `ros-node` property set and reads are a service under the hood.

## return-type
Defines the data type we're expecting in response. JSON is used if nothing is provided.
Currently only JSON is supported so we leave this field untouched.


## target-id
Specifies which target we are refering to. Either an entity id, ros-node path, service path or an ros-topic path.
To list the available options use `--list` in place of `target-id`. In which case the `return-type` is ignored and will be JSON, the rest of the input is also ignored.


## information-id
Specifies which property we are accessing. only used if `target-type` is `ros-node` or `entity`
Use `--list` to see the available properties.

