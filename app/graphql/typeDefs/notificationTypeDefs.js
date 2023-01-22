import { gql } from "apollo-server-express"

const notification = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {
    ##-------------------------------FOR NOTIFICATION-----------------------------------------##
    "This getNotification query get all notification "
    getNotification: [Notification]

    "getUserNotification query get user notification by using token"
    getUserNotification(input: getUserNotificationInput): [Notification]
  }
  type Mutation {
    ##------------------------------FOR NOTIFICATION-------------------------------------------##
    " The addNotification mutation is used to add notification"
    addNotification(input: addNotificationInput): Notification

    updateNotification(input: forUpdateNotication): String

    "The deleteNotification mutation is used to delete notification"
    deleteNotification(input: deleteNotificationInput): String
  }

  type Notification {
    id: ID
    Message: String
    userId: ID
    vmId: ID
    Readed: Boolean
  }

  input getUserNotificationInput {
    token: String
  }

  input addNotificationInput {
    Message: String
    userId: ID
    vmId: ID
    Readed: Boolean
  }

  input forUpdateNotication {
    userId: ID
    Readed: Boolean
  }

  input deleteNotificationInput {
    id: ID
  }
`;

export default notification;
