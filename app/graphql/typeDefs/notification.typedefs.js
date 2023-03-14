const { gql, GraphQlUpload } = require('apollo-server-express');

const notification = gql`
  scalar JSON
  scalar Number
  scalar Upload
  scalar Date

  type Query {

  ##-------------------------------FOR NOTIFICATION-----------------------------------------##
  getNotification: [Notification]
    getUserNotification (input: for_token ):[Notification]


  }
  type Mutation {

 ##------------------------------FOR NOTIFICATION-------------------------------------------##
 addNotification(input: Notification_VM): Notification
    updateNotification(input: forUpdateNotication): String
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
  input Notification_VM {
    Message: String
    userId: ID
    vmId: ID
    Readed: Boolean
  }


  `;

module.exports = notification;
