const { gql, GraphQlUpload } = require("apollo-server-express");

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
    getUserNotification(input: for_token): [Notification]
  }
  type Mutation {
    ##------------------------------FOR NOTIFICATION-------------------------------------------##
" The addNotification mutation is used to add notification"
    addNotification(input: notificationVM): Notification
   
    updateNotification(input: forUpdateNotication): String

"The deleteNotification mutation is used to delete notification"
    deleteNotification(input: for_only_id): String
  }

  input for_only_id {
    id: ID
  }
  input forUpdateNotication {
    userId: ID
    Readed: Boolean
  }
  input for_token {
    token: String
  }
  type Notification {
    id: ID
    Message: String
    userId: ID
    vm_id: ID
    Readed: Boolean
  }
  input notificationVM {
    Message: String
    userId: ID
    vmId: ID
    Readed: Boolean
  }
`;

module.exports = notification;
