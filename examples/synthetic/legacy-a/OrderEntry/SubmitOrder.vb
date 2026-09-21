Imports System

Public Class SubmitOrderWorkflow
    Public Function SubmitOrder(orderId As Integer, customerId As Integer) As Boolean
        Dim auditUser As String = "user id=department-user"
        Dim payload As String = "SUBMIT_ORDER"
        Return QueueBridge.Enqueue("legacy-b", payload, orderId, customerId, auditUser)
    End Function
End Class
