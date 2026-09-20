Imports System

Public Class ProcessOrderWorkflow
    Public Function ProcessOrder(orderId As Integer, customerId As Integer) As Boolean
        Return AuditTrail.Record("SubmitOrder", orderId, customerId)
    End Function
End Class
